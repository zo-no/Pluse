# 0003 — Quest 统一数据模型

**状态**: draft  
**类型**: core  
**优先级**: high  
**取代**: 0002 中 Session/Task 双表方案

---

## 背景与动机

0002 设计了 Session 和 AI Task 两张独立的表，实现后暴露了根本矛盾：

- AI Task 执行需要 AI 上下文（codexThreadId / claudeSessionId）维持连续性
- 方案让 Task 自动创建 Session 作为"执行容器"
- 结果：Session 列表堆满系统自动创建的容器，对话与自动执行混在一起无法区分
- Session ↔ Task 互转时两者共用同一个 Session，产生并发写入冲突

**根本原因**：Session 和 AI Task 本质上是同一个 AI 对话上下文的两种使用方式，强行分成两张表需要大量胶水代码，且无法从根本上解决共用问题。

本 spec 以 **Quest** 作为统一的核心对象重新建模。

---

## 命名约定

| 层级 | session 态 | task 态 |
|------|-----------|---------|
| 代码 / 数据库 | Quest (kind='session') | Quest (kind='task') |
| 英文 UI | Session | Task |
| 中文 UI | 会话 | 任务 |

**Quest 是内部技术名词，不在用户界面上直接展示。**

---

## 核心设计原则

1. **Quest 是统一容器**：Session 和 AI Task 合并为 Quest，`kind` 字段区分形态
2. **kind 互斥**：同一时刻 Quest 只能是 `session` 或 `task`，用户可手动切换
3. **AI 上下文在 kind 切换时保留**：`codexThreadId` / `claudeSessionId` 是 Quest 的属性，切换 kind 时不清除
4. **provider context id 不是主键**：Quest 的主键是 Pluse 自己生成的 `qst_xxx`，provider id 只用于 resume
5. **调度配置直接放在 Quest 上**：task 态的调度/执行器配置是 Quest 自身的字段，不需要独立子对象
6. **Todo 独立建模**：人工待办与 AI 对话上下文无关，单独一张表；AI 通过 API/CLI 主动查询，不做事件推送

---

## 数据结构

### Quest

```typescript
type QuestKind = 'session' | 'task'

type QuestStatus =
  | 'idle'       // session 态：无活跃 run
  | 'running'    // 有活跃 run
  | 'pending'    // task 态：等待调度触发
  | 'done'       // task 态：once 任务完成
  | 'failed'     // task 态：执行失败
  | 'cancelled'  // task 态：已取消

interface Quest {
  id: string           // 'qst_' + hex
  projectId: string
  kind: QuestKind
  createdBy: 'human' | 'ai' | 'system'
  createdAt: string
  updatedAt: string

  // AI 侧 provider context 标识（项目内唯一，非主键）
  codexThreadId?: string
  claudeSessionId?: string

  // 运行时偏好（共用）
  tool?: string        // 'claude' | 'codex'
  model?: string
  effort?: string
  thinking?: boolean
  activeRunId?: string

  // ── session 态字段（kind = 'session'）────────────────────────
  name?: string
  autoRenamePending?: boolean
  pinned?: boolean
  deleted?: boolean      // 归档（软删除），不出现在任何列表
  deletedAt?: string
  followUpQueue?: QueuedMessage[]

  // ── task 态字段（kind = 'task'）──────────────────────────────
  title?: string
  description?: string
  status?: QuestStatus
  enabled?: boolean
  scheduleKind?: 'once' | 'scheduled' | 'recurring'
  scheduleConfig?: ScheduleConfig
  executorKind?: 'ai_prompt' | 'script'
  executorConfig?: AiPromptConfig | ScriptConfig
  executorOptions?: ExecutorOptions
  completionOutput?: string
  reviewOnComplete?: boolean   // 仅 automation/manual run 完成后触发，chat run 不触发
  order?: number
}

interface QueuedMessage {
  requestId: string
  text: string
  tool: string
  model: string | null
  effort: string | null
  thinking: boolean
}

interface ScheduleConfig {
  cron?: string
  runAt?: string
  timezone?: string
}

interface AiPromptConfig {
  prompt: string
  agent?: 'claude' | 'codex'
  model?: string
}

interface ScriptConfig {
  command: string
  workDir?: string
  env?: Record<string, string>
  timeout?: number
}

interface ExecutorOptions {
  continueQuest?: boolean    // false = 每次执行用新的 AI 上下文
  customVars?: Record<string, string>
}
```

**kind 切换约束：**
- `activeRunId` 非空时不允许切换
- 切换时打一条 `quest_ops` log
- `codexThreadId` / `claudeSessionId` 切换后保持不变

---

### Todo

人工待办，独立于 Quest。AI 在执行时通过 API/CLI 主动查询，不做事件推送。

```typescript
interface Todo {
  id: string           // 'todo_' + hex
  projectId: string
  createdBy: 'human' | 'ai' | 'system'
  originQuestId?: string   // 溯源：由哪个 Quest 触发创建（可选）

  title: string
  description?: string
  waitingInstructions?: string

  status: 'pending' | 'done' | 'cancelled'

  createdAt: string
  updatedAt: string
}
```

---

### Run（统一执行记录）

```typescript
type RunTrigger = 'chat' | 'manual' | 'automation'

interface Run {
  id: string           // 'run_' + hex
  questId: string
  projectId: string
  requestId: string

  trigger: RunTrigger
  triggeredBy: 'human' | 'scheduler' | 'api' | 'cli'

  state: 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled'
  failureReason?: string   // state='failed' 时：'timeout' | 'process_lost' | 'error'

  tool: string
  model: string
  effort?: 'low' | 'medium' | 'high'
  thinking: boolean

  // 本次执行后 AI 返回的 provider context，完成后同步回 Quest
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

---

### QuestOp（操作日志）

```typescript
type QuestOpKind =
  | 'created'
  | 'kind_changed'
  | 'triggered'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'status_changed'
  | 'deleted'

interface QuestOp {
  id: string
  questId: string
  op: QuestOpKind
  fromKind?: QuestKind
  toKind?: QuestKind
  fromStatus?: string
  toStatus?: string
  actor: 'human' | 'ai' | 'scheduler' | 'system'
  note?: string
  createdAt: string
}
```

---

## 核心流程

### kind 切换：session → task

```
用户操作：把当前会话转为定期任务

PATCH /api/quests/:id
{ kind: 'task', title: '...', scheduleKind: 'recurring', scheduleConfig: { cron: '0 9 * * *' }, executorKind: 'ai_prompt', executorConfig: { prompt: '...' } }

服务端：
  1. 校验 quest.kind === 'session' 且 activeRunId 为空
  2. quest.kind = 'task'
  3. 写入 title / scheduleKind / scheduleConfig / executorKind / executorConfig
  4. status 重置为 'pending'（无论之前是什么状态）
  4. codexThreadId 保持不变 ← AI 记得之前的对话
  5. 打 quest_ops: { op: 'kind_changed', fromKind: 'session', toKind: 'task' }
  6. 注册调度器
```

**status 重置规则：** 每次切回 task 态时，status 一律重置为 `pending`，不管之前是 `done` / `failed` / `cancelled`。这样 once task 也可以重新执行。

### kind 切换：task → session

```
用户操作：把任务切回会话继续对话（直接切换，无弹窗）

PATCH /api/quests/:id
{ kind: 'session', name: '...' }

服务端：
  1. 校验 quest.kind === 'task' 且 activeRunId 为空
  2. quest.kind = 'session'
  3. 设置 name（默认用 title）
  4. task 态字段（scheduleKind / scheduleConfig / executorConfig 等）保留不清空
     ← 切回 task 时配置仍在，无需重新填写
  5. codexThreadId 保持不变 ← 用户能看到任务执行的完整历史
  6. 打 quest_ops: { op: 'kind_changed', fromKind: 'task', toKind: 'session' }
  7. 调度器暂停（注销本次调度），配置保留
```

### task 态执行

```
调度器 / 手动触发：

  1. 校验 quest.kind === 'task' && quest.enabled && activeRunId 为空
  2. quest.status = 'running', quest.activeRunId = run.id
  3. 创建 Run { questId, trigger: 'automation'|'manual', triggeredBy }
  4. 构建消息：interpolate(executorConfig.prompt, vars)
  5. 执行：
       if executorOptions.continueQuest && quest.codexThreadId:
         codex exec resume <quest.codexThreadId> <prompt>
       else:
         codex exec <prompt>
  6. 执行完成：
       run.codexThreadId = AI 返回的 threadId
       quest.codexThreadId = run.codexThreadId
       quest.status = 'pending'（recurring）| 'done'（once）
       quest.activeRunId = null
       quest.completionOutput = 最后一条 AI 输出
  7. 打 quest_ops log
```

### reviewOnComplete

task 态执行完成后，若 `reviewOnComplete = true`，创建 Todo：

```typescript
Todo {
  projectId:           quest.projectId,
  originQuestId:       quest.id,
  title:               `Review: ${quest.title}`,
  waitingInstructions: 'AI task completed. Please review the output.',
  createdBy:           'system',
}
```

---

## 数据库 Schema

```sql
CREATE TABLE quests (
  id                   TEXT PRIMARY KEY NOT NULL,
  project_id           TEXT NOT NULL REFERENCES projects(id),
  kind                 TEXT NOT NULL DEFAULT 'session',
  created_by           TEXT NOT NULL DEFAULT 'human',

  -- provider context（项目内唯一，非主键）
  codex_thread_id      TEXT,
  claude_session_id    TEXT,

  -- 运行时偏好（共用）
  tool                 TEXT,
  model                TEXT,
  effort               TEXT,
  thinking             INTEGER DEFAULT 0,
  active_run_id        TEXT,

  -- session 态
  name                 TEXT,
  auto_rename_pending  INTEGER DEFAULT 0,
  pinned               INTEGER DEFAULT 0,
  deleted              INTEGER NOT NULL DEFAULT 0,  -- 归档（软删除）
  deleted_at           TEXT,
  follow_up_queue      TEXT NOT NULL DEFAULT '[]',

  -- task 态
  title                TEXT,
  description          TEXT,
  status               TEXT NOT NULL DEFAULT 'idle',
  enabled              INTEGER NOT NULL DEFAULT 1,
  schedule_kind        TEXT,
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

CREATE UNIQUE INDEX idx_quests_codex_thread
  ON quests (project_id, codex_thread_id)
  WHERE codex_thread_id IS NOT NULL;

CREATE UNIQUE INDEX idx_quests_claude_session
  ON quests (project_id, claude_session_id)
  WHERE claude_session_id IS NOT NULL;

CREATE INDEX idx_quests_project
  ON quests (project_id, kind, deleted, pinned DESC, updated_at DESC);
CREATE INDEX idx_quests_status
  ON quests (project_id, kind, status);


CREATE TABLE todos (
  id                   TEXT PRIMARY KEY NOT NULL,
  project_id           TEXT NOT NULL REFERENCES projects(id),
  created_by           TEXT NOT NULL DEFAULT 'human',
  origin_quest_id      TEXT REFERENCES quests(id),
  title                TEXT NOT NULL,
  description          TEXT,
  waiting_instructions TEXT,
  status               TEXT NOT NULL DEFAULT 'pending',
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
) STRICT;

CREATE INDEX idx_todos_project ON todos (project_id, status);


CREATE TABLE runs (
  id                    TEXT PRIMARY KEY NOT NULL,
  quest_id              TEXT NOT NULL REFERENCES quests(id),
  project_id            TEXT NOT NULL REFERENCES projects(id),
  request_id            TEXT NOT NULL,
  trigger               TEXT NOT NULL DEFAULT 'chat',
  triggered_by          TEXT NOT NULL DEFAULT 'human',
  state                 TEXT NOT NULL DEFAULT 'accepted',
  -- 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled'
  failure_reason        TEXT,
  -- state='failed' 时：'timeout' | 'process_lost' | 'error'
  tool                  TEXT NOT NULL DEFAULT 'codex',
  model                 TEXT NOT NULL,
  effort                TEXT,   -- 'low' | 'medium' | 'high'
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

CREATE INDEX idx_runs_quest ON runs (quest_id, created_at DESC);
CREATE INDEX idx_runs_project ON runs (project_id, created_at DESC);


CREATE TABLE run_spool (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id  TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  ts      TEXT NOT NULL,
  line    TEXT NOT NULL
) STRICT;

CREATE INDEX idx_run_spool_run ON run_spool (run_id, id ASC);


CREATE TABLE quest_ops (
  id          TEXT PRIMARY KEY NOT NULL,
  quest_id    TEXT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  op          TEXT NOT NULL,
  from_kind   TEXT,
  to_kind     TEXT,
  from_status TEXT,
  to_status   TEXT,
  actor       TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL
) STRICT;

CREATE INDEX idx_quest_ops_quest ON quest_ops (quest_id, created_at DESC);
```

---

## API

**HTTP API：**
```
# Quest
GET    /api/quests?projectId=&kind=session|task&deleted=
POST   /api/quests
GET    /api/quests/:id
PATCH  /api/quests/:id
DELETE /api/quests/:id

# session 态：发消息（chat run）
POST   /api/quests/:id/messages

# followUpQueue 管理
DELETE /api/quests/:id/queue/:requestId
DELETE /api/quests/:id/queue

# task 态：手动触发执行（manual run）
POST   /api/quests/:id/run

# Run
GET    /api/quests/:id/runs
GET    /api/runs/:id
GET    /api/runs/:id/spool
POST   /api/runs/:id/cancel

# Todo
GET    /api/todos?projectId=&status=
POST   /api/todos
GET    /api/todos/:id
PATCH  /api/todos/:id
POST   /api/todos/:id/done
POST   /api/todos/:id/cancel
DELETE /api/todos/:id

# Project
GET    /api/projects
POST   /api/projects/open
GET    /api/projects/:id
GET    /api/projects/:id/overview
PATCH  /api/projects/:id
POST   /api/projects/:id/archive
DELETE /api/projects/:id

# Commands（供 AI 查询所有可用命令）
GET    /api/commands
```

**CLI（供 AI 调用）：**
```bash
# 查询所有可用命令
pluse commands [--json]

# Quest
pluse quest list --project <id> [--kind session|task] [--json]
pluse quest get <id> [--json]
pluse quest create --project <id> --kind session|task [--name <name>] [--json]
pluse quest delete <id>

# Run
pluse quest run <id> [--json]          # task 态手动触发
pluse run list --quest <id> [--json]
pluse run cancel <id>

# Todo
pluse todo list --project <id> [--status pending|done|cancelled] [--json]
pluse todo get <id> [--json]
pluse todo create --project <id> --title <title> [--description <desc>] [--waiting-instructions <text>] [--origin-quest <questId>] [--json]
pluse todo done <id>
pluse todo cancel <id>
pluse todo delete <id>

# Project
pluse project list [--json]
pluse project get <id> [--json]
pluse project overview <id> [--json]
pluse project open --work-dir <path> [--name <name>] [--goal <goal>] [--system-prompt <prompt>] [--pin] [--json]
pluse project update <id> [--name <name>] [--goal <goal>] [--system-prompt <prompt>] [--pin] [--unpin] [--archive] [--json]
pluse project archive <id> [--json]
pluse project delete <id> --confirm [--json]
```

---

## 废弃对照表

| 废弃 | 替代 |
|------|------|
| `sessions` 表 | `quests`（kind='session'） |
| `tasks` 表（assignee='ai'） | `quests`（kind='task'） |
| `tasks` 表（assignee='human'） | `todos` |
| `runs`（旧 session_id） | `runs`（新 quest_id） |
| `task_runs` 表 | `runs`（统一） |
| `task_ops` 表 | `quest_ops` |
| `task_run_spool` 表 | `run_spool` |
| `Task.sessionId` | 删除，quest.codexThreadId 直接更新 |
| `ensureTaskSession()` | 删除 |

---

## 验收标准

- [ ] `quests` 表统一存储 Session（kind='session'）和 AI Task（kind='task'）
- [ ] `codexThreadId` / `claudeSessionId` 在项目内唯一索引约束
- [ ] `todos` 表独立存储人工待办
- [ ] `runs` 表统一存储所有执行记录，`trigger` 字段区分 chat/manual/automation
- [ ] kind 切换时 codexThreadId 保持不变
- [ ] 执行中（activeRunId 非空）不允许切换 kind
- [ ] Session 列表不再出现系统自动创建的执行容器
- [ ] task 态执行不再自动创建 Session
