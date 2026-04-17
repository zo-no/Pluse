# 0003 — Thread 统一数据模型

**状态**: draft  
**类型**: core  
**优先级**: high  
**估算**: XL

---

## 背景与动机

0002 设计了 Session 和 Task 两套并行体系，但实现中暴露了根本矛盾：

- AI Task 执行需要 AI thread（codexThreadId / claudeSessionId）维持上下文
- 现有方案让 Task 自动创建 Session 作为"执行容器"
- 结果：Session 列表堆满系统自动创建的 Session，用户对话与任务执行混在一起
- Session ↔ Task 互转时两者共用同一个 Session，产生并发写入冲突

**根本原因**：Session 和 AI Task 本质上是同一个东西的两种形态——**一个 AI 对话线程的容器**。区别只是触发方：

| | Session | Task |
|---|---|---|
| 触发方 | 人主动发消息 | 系统按调度自动发消息 |
| 执行形式 | 一问一答 | 一问一答 |
| AI thread | codexThreadId / claudeSessionId | 同上 |

强行分成两张表，反而需要大量胶水代码维持关系，且无法避免共用问题。

---

## 核心设计原则

1. **Thread 是统一容器**：Session 和 AI Task 合并为 Thread，`kind` 字段区分形态
2. **一个 AI thread 只属于一个 Thread 记录**：`codexThreadId` / `claudeSessionId` 在项目内全局唯一，不会出现两个容器共用
3. **kind 可切换，threadId 不变**：Session → Task 或 Task → Session，AI 上下文完整保留，threadId 是在两种形态间流动的"上下文接力棒"
4. **Human Task 独立为 Todo**：人工待办项与 AI 对话线程无关，单独建模
5. **执行记录统一**：Session 的 Run 和 Task 的 TaskRun 合并为统一的 runs 表

---

## 数据结构

### Thread

```typescript
type ThreadKind = 'session' | 'task'

type ThreadStatus =
  | 'idle'       // session 形态：无活跃 run
  | 'running'    // 有活跃 run（session 交互中 或 task 执行中）
  | 'pending'    // task 形态：等待调度触发
  | 'done'       // task 形态：once 任务完成
  | 'failed'     // task 形态：执行失败
  | 'cancelled'  // task 形态：已取消
  | 'blocked'    // task 形态：等待依赖的 Todo 完成

interface Thread {
  id: string           // 'thr_' + hex
  projectId: string
  kind: ThreadKind
  createdBy: 'human' | 'ai' | 'system'
  createdAt: string
  updatedAt: string

  // ── AI 侧 thread 标识 ──────────────────────────────────────────
  // kind 切换时保留不变，是上下文延续的"接力棒"
  codexThreadId?: string
  claudeSessionId?: string

  // ── Session 形态字段（kind = 'session'）────────────────────────
  name?: string
  autoRenamePending?: boolean
  pinned?: boolean
  archived?: boolean
  archivedAt?: string
  tool?: string
  model?: string
  effort?: string
  thinking?: boolean
  activeRunId?: string
  followUpQueue?: QueuedMessage[]

  // ── Task 形态字段（kind = 'task'）──────────────────────────────
  title?: string
  description?: string
  status?: ThreadStatus
  enabled?: boolean
  scheduleConfig?: ScheduleConfig   // once / scheduled / recurring
  executor?: TaskExecutor           // ai_prompt | script
  executorOptions?: ExecutorOptions
  completionOutput?: string         // 最近一次执行的输出摘要
  reviewOnComplete?: boolean        // 完成后自动创建 Todo 让人确认
  order?: number
}
```

**kind 切换约束：**
- `status === 'running'` 或 `activeRunId` 不为空时，不允许切换
- 切换时打一条 `thread_ops` log
- `codexThreadId` / `claudeSessionId` 切换后保持不变

---

### Todo（原 Human Task）

Human Task 与 AI 对话线程无关，独立建模。

```typescript
interface Todo {
  id: string           // 'todo_' + hex
  projectId: string
  createdBy: 'human' | 'ai' | 'system'
  originThreadId?: string   // 溯源：由哪个 Thread 触发创建

  title: string
  description?: string
  waitingInstructions?: string

  status: 'pending' | 'done' | 'cancelled'
  blockedByTodoId?: string

  createdAt: string
  updatedAt: string
}
```

---

### Run（统一执行记录）

Session 的 Run 与 Task 的 TaskRun 合并。

```typescript
type RunKind =
  | 'interactive'  // session 形态：人发消息触发
  | 'scheduled'    // task 形态：调度器触发
  | 'manual'       // task 形态：手动触发
  | 'once'         // task 形态：once 任务触发

interface Run {
  id: string           // 'run_' + hex
  threadId: string
  projectId: string
  requestId: string    // 幂等键

  kind: RunKind
  triggeredBy: 'human' | 'scheduler' | 'api' | 'cli'

  state: 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled'
  result?: 'success' | 'error' | 'cancelled'
  failureReason?: string

  tool: string
  model: string
  effort?: string
  thinking: boolean

  // 本次执行后 AI 返回的 thread 标识，完成后同步回 Thread
  codexThreadId?: string
  claudeSessionId?: string

  cancelRequested: boolean
  runnerProcessId?: number
  contextInputTokens?: number
  contextWindowTokens?: number

  createdAt: string
  startedAt?: string
  updatedAt: string
  completedAt?: string
  finalizedAt?: string
}
```

**run_spool** 不变，按 `run_id` 存流式输出。

---

### ThreadOp（操作日志）

记录所有状态变更，包括 kind 切换。

```typescript
type ThreadOpKind =
  | 'created'
  | 'kind_changed'     // session ↔ task 切换
  | 'triggered'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'status_changed'
  | 'unblocked'
  | 'deleted'

interface ThreadOp {
  id: string
  threadId: string
  op: ThreadOpKind
  fromKind?: ThreadKind
  toKind?: ThreadKind
  fromStatus?: string
  toStatus?: string
  actor: 'human' | 'ai' | 'scheduler' | 'system'
  note?: string
  createdAt: string
}
```

---

## 核心流程

### Session → Task（把对话变成定期任务）

```
用户操作：把当前 Session 转为定期任务

PUT /api/threads/:id/kind
{ kind: 'task', title: '...', scheduleConfig: { kind: 'recurring', cron: '*/30 * * * *' }, executor: { ... } }

服务端：
  1. 校验 thread.kind === 'session' 且无活跃 run
  2. thread.kind = 'task'
  3. 写入 title / scheduleConfig / executor / status = 'pending'
  4. codexThreadId 保持不变 ← AI 记得之前的对话
  5. 打 thread_ops: { op: 'kind_changed', fromKind: 'session', toKind: 'task' }
  6. 注册调度器
```

### Task → Session（接着任务执行结果继续对话）

```
用户操作：把任务切回 Session 继续对话

PUT /api/threads/:id/kind
{ kind: 'session', name: '...' }

服务端：
  1. 校验 thread.kind === 'task' 且 status !== 'running'
  2. thread.kind = 'session'
  3. 清空 scheduleConfig / executor / status
  4. 设置 name（默认用 title）
  5. codexThreadId 保持不变 ← 用户能看到任务执行的完整历史
  6. 打 thread_ops: { op: 'kind_changed', fromKind: 'task', toKind: 'session' }
  7. 注销调度器
```

### Task 执行（向 Thread 发送一条预设消息）

```
调度器 / 手动触发：

  1. 校验 thread.kind === 'task' && thread.enabled && status !== 'running'
  2. thread.status = 'running'
  3. 创建 Run { threadId, kind: 'scheduled'|'manual', triggeredBy }
  4. 构建消息：interpolate(executor.prompt, vars)
  5. 执行：
       if executorOptions.continueSession && thread.codexThreadId:
         codex exec resume <thread.codexThreadId> <prompt>
       else:
         codex exec <prompt>
  6. 执行完成：
       run.codexThreadId = AI 返回的 threadId
       thread.codexThreadId = run.codexThreadId  ← 更新接力棒
       thread.status = 'pending'（recurring）| 'done'（once）
       thread.completionOutput = 最后一条 AI 输出
  7. 打 thread_ops log

不再自动创建 Session，不再有 ensureTaskSession()
```

### Task 执行期间的用户操作

Task 执行期间 `thread.kind = 'task'` 且 `status = 'running'`：
- 前端 disable 切换按钮和输入框
- 不接受 followUpQueue
- 用户只能查看 run_spool 的实时输出
- 执行完成后可切换回 session 形态继续对话

### reviewOnComplete

Thread（task 形态）执行完成后，若 `reviewOnComplete = true`，创建 Todo 通知：

```typescript
Todo {
  projectId:           thread.projectId,
  originThreadId:      thread.id,
  title:               `Review: ${thread.title}`,
  waitingInstructions: 'AI task completed. Please review the output.',
  createdBy:           'system',
}
```

---

## 数据库 Schema

```sql
CREATE TABLE threads (
  id                   TEXT PRIMARY KEY NOT NULL,
  project_id           TEXT NOT NULL REFERENCES projects(id),
  kind                 TEXT NOT NULL DEFAULT 'session',
  created_by           TEXT NOT NULL DEFAULT 'human',
  status               TEXT NOT NULL DEFAULT 'idle',

  -- AI thread 标识（项目内唯一）
  codex_thread_id      TEXT,
  claude_session_id    TEXT,

  -- Session 形态
  name                 TEXT,
  auto_rename_pending  INTEGER DEFAULT 0,
  pinned               INTEGER DEFAULT 0,
  archived             INTEGER DEFAULT 0,
  archived_at          TEXT,
  tool                 TEXT,
  model                TEXT,
  effort               TEXT,
  thinking             INTEGER DEFAULT 0,
  active_run_id        TEXT,
  follow_up_queue      TEXT NOT NULL DEFAULT '[]',

  -- Task 形态
  title                TEXT,
  description          TEXT,
  enabled              INTEGER NOT NULL DEFAULT 1,
  schedule_config      TEXT,
  executor_kind        TEXT,
  executor_config      TEXT,
  executor_options     TEXT,
  completion_output    TEXT,
  review_on_complete   INTEGER NOT NULL DEFAULT 0,
  order_index          INTEGER,

  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
) STRICT;

-- codexThreadId / claudeSessionId 在项目内全局唯一
CREATE UNIQUE INDEX idx_threads_codex_thread
  ON threads (project_id, codex_thread_id)
  WHERE codex_thread_id IS NOT NULL;

CREATE UNIQUE INDEX idx_threads_claude_session
  ON threads (project_id, claude_session_id)
  WHERE claude_session_id IS NOT NULL;

CREATE INDEX idx_threads_project
  ON threads (project_id, kind, archived, pinned DESC, updated_at DESC);
CREATE INDEX idx_threads_status
  ON threads (project_id, kind, status);


CREATE TABLE todos (
  id                   TEXT PRIMARY KEY NOT NULL,
  project_id           TEXT NOT NULL REFERENCES projects(id),
  created_by           TEXT NOT NULL DEFAULT 'human',
  origin_thread_id     TEXT REFERENCES threads(id),
  title                TEXT NOT NULL,
  description          TEXT,
  waiting_instructions TEXT,
  status               TEXT NOT NULL DEFAULT 'pending',
  blocked_by_todo_id   TEXT REFERENCES todos(id),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
) STRICT;

CREATE INDEX idx_todos_project ON todos (project_id, status);


CREATE TABLE runs (
  id                    TEXT PRIMARY KEY NOT NULL,
  thread_id             TEXT NOT NULL REFERENCES threads(id),
  project_id            TEXT NOT NULL REFERENCES projects(id),
  request_id            TEXT NOT NULL,
  kind                  TEXT NOT NULL DEFAULT 'interactive',
  triggered_by          TEXT NOT NULL DEFAULT 'human',
  state                 TEXT NOT NULL DEFAULT 'accepted',
  result                TEXT,
  failure_reason        TEXT,
  tool                  TEXT NOT NULL DEFAULT 'codex',
  model                 TEXT NOT NULL,
  effort                TEXT,
  thinking              INTEGER DEFAULT 0,
  codex_thread_id       TEXT,
  claude_session_id     TEXT,
  cancel_requested      INTEGER DEFAULT 0,
  runner_process_id     INTEGER,
  context_input_tokens  INTEGER,
  context_window_tokens INTEGER,
  created_at            TEXT NOT NULL,
  started_at            TEXT,
  updated_at            TEXT NOT NULL,
  completed_at          TEXT,
  finalized_at          TEXT
) STRICT;

CREATE INDEX idx_runs_thread ON runs (thread_id, created_at DESC);
CREATE INDEX idx_runs_project ON runs (project_id, created_at DESC);


CREATE TABLE run_spool (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id  TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  ts      TEXT NOT NULL,
  line    TEXT NOT NULL
) STRICT;

CREATE INDEX idx_run_spool_run ON run_spool (run_id, id ASC);


CREATE TABLE thread_ops (
  id          TEXT PRIMARY KEY NOT NULL,
  thread_id   TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  op          TEXT NOT NULL,
  from_kind   TEXT,
  to_kind     TEXT,
  from_status TEXT,
  to_status   TEXT,
  actor       TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL
) STRICT;

CREATE INDEX idx_thread_ops_thread ON thread_ops (thread_id, created_at DESC);
```

---

## 废弃对照表

| 废弃 | 替代 |
|------|------|
| `sessions` 表 | `threads`（kind='session'） |
| `tasks` 表（assignee='ai'） | `threads`（kind='task'） |
| `tasks` 表（assignee='human'） | `todos` |
| `runs` 表（旧 session_id） | `runs`（新 thread_id） |
| `task_runs` 表 | `runs`（统一） |
| `task_logs` 表 | `runs`（runs 本身即执行记录） |
| `task_ops` 表 | `thread_ops` |
| `task_run_spool` 表 | `run_spool` |
| `Task.sessionId` | 删除 |
| `Task.lastSessionId` | 删除，`thread.codexThreadId` 直接更新 |
| `ensureTaskSession()` | 删除 |

---

## API

```
# Thread
GET    /api/threads?projectId=&kind=session|task&archived=
POST   /api/threads
GET    /api/threads/:id
PATCH  /api/threads/:id
DELETE /api/threads/:id

# Kind 切换
PUT    /api/threads/:id/kind   { kind, ...fields }

# Session 形态：发消息
POST   /api/threads/:id/message

# Task 形态：手动触发执行
POST   /api/threads/:id/run

# Run 记录
GET    /api/threads/:id/runs
GET    /api/runs/:id
GET    /api/runs/:id/spool

# Todo
GET    /api/todos?projectId=
POST   /api/todos
PATCH  /api/todos/:id
POST   /api/todos/:id/done
POST   /api/todos/:id/cancel
```

---

## 迁移策略

1. 新建 `threads` / `todos` / `thread_ops` / `run_spool` 表
2. 数据迁移：
   - `sessions` → `threads`（kind='session'）
   - `tasks`（assignee='ai'）→ `threads`（kind='task'）
   - `tasks`（assignee='human'）→ `todos`
   - `runs`（旧）→ `runs`（新，`session_id` → `thread_id`，`kind='interactive'`）
   - `task_runs` → `runs`（新，`task_id` → `thread_id`，`kind='scheduled'|'manual'`）
   - `task_ops` → `thread_ops`
   - `task_run_spool` → `run_spool`
3. 删除旧表
4. 更新所有 API 路径

---

## 验收标准

### 数据模型
- [ ] `threads` 表统一存储 Session 和 AI Task
- [ ] `codexThreadId` / `claudeSessionId` 在项目内唯一索引约束
- [ ] `todos` 表独立存储 Human Task
- [ ] `runs` 表统一存储所有执行记录（session 交互 + task 执行）
- [ ] `thread_ops` 记录所有状态变更，包含 kind 切换日志

### Session 形态
- [ ] Session 列表不再出现系统自动创建的执行容器
- [ ] followUpQueue 正常工作
- [ ] autoRename 正常工作

### Task 形态
- [ ] Project Brain 执行不再自动创建 Session
- [ ] 执行记录写入 `runs` 表，可在 Thread 详情查看
- [ ] `continueSession=true` 时通过 `thread.codexThreadId` resume，不依赖 Session

### kind 切换
- [ ] Session → Task：codexThreadId 保持不变，下次执行能续接上下文
- [ ] Task → Session：用户能看到任务执行历史，并继续对话
- [ ] 执行中不允许切换 kind，前端 disable 切换入口
- [ ] 每次切换打 `thread_ops` log

### Todo
- [ ] Human Task 功能不退化（创建、完成、取消、blockedBy）
- [ ] `reviewOnComplete` 触发创建 Todo 通知
