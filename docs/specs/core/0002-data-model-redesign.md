# 0002 — Session / Task 数据模型重新设计

**状态**: done  
**优先级**: high  
**估算**: L

---

## 背景

当前代码库里的 Task 系统是 AI 自行发明的，包含大量未经设计的字段（`surface`、`visibleInChat`、`origin`/`createdBy` 重复等）。需要从产品逻辑出发重新定义 Session 和 Task 的数据结构与关系。

---

## 核心设计原则

1. **字段克制**：每个字段有明确语义，不留"以后可能用到"的字段
2. **来源可追溯**：Session 和 Task 都知道自己是谁创建的、从哪来的
3. **Agent 友好**：系统提示只注入最小上下文，AI 通过 CLI/API 自查其余信息
4. **不融合表**：Session 和 Task 职责不同，各自保持干净结构，通过引用互转
5. **每个能力 API + CLI 对等**：所有操作同时提供 HTTP 接口和 CLI 命令

---

## 数据结构

### Project（不变）

```typescript
interface Project {
  id: string            // 'proj_' + hex
  name: string
  workDir: string       // 本地文件夹绝对路径
  goal?: string         // 项目目标（注入项目级系统提示）
  systemPrompt?: string // 项目级系统提示
  createdAt: string
  updatedAt: string
}
```

---

### Session

```typescript
interface Session {
  id: string
  projectId: string

  // 来源
  createdBy: 'human' | 'ai' | 'system'
  sourceTaskId?: string   // 由哪个 Task 触发创建

  // 显示
  name: string
  autoRenamePending?: boolean
  pinned?: boolean
  archived?: boolean
  archivedAt?: string

  // 运行时偏好
  tool?: string           // 使用的 AI 工具（claude / codex）
  model?: string
  effort?: string
  thinking?: boolean

  // AI 侧 resume 标识
  claudeSessionId?: string
  codexThreadId?: string

  // 执行状态
  activeRunId?: string

  // 消息队列（AI 回复期间用户发的消息暂存于此）
  followUpQueue: QueuedMessage[]

  createdAt: string
  updatedAt: string
}

interface QueuedMessage {
  requestId: string   // 幂等键
  text: string
  tool: string
  model: string | null
  effort: string | null
  thinking: boolean
}
```

**变化：**
- 新增 `createdBy`、`sourceTaskId`
- `followUpQueue` 保留在 Session（Run 结束后队列不丢失）

---

### Run（不变）

```typescript
interface Run {
  id: string
  sessionId: string
  requestId: string

  state: 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled'
  result?: 'success' | 'error' | 'cancelled'
  failureReason?: string

  model: string
  effort?: string
  thinking: boolean

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

### Task

```typescript
interface Task {
  id: string
  projectId: string

  // 来源
  createdBy: 'human' | 'ai' | 'system'
  originSessionId?: string  // 在哪个会话里被创建（溯源）

  // 内容
  title: string
  description?: string
  waitingInstructions?: string  // Human Task 的操作说明

  // 执行者
  assignee: 'ai' | 'human'

  // 调度
  kind: 'once' | 'scheduled' | 'recurring'
  status: TaskStatus
  enabled: boolean
  scheduleConfig?: ScheduleConfig
  blockedByTaskId?: string

  // AI Task 执行配置（assignee === 'ai' 时有效）
  executor?: AiPromptExecutor | ScriptExecutor
  executorOptions?: ExecutorOptions

  // AI Task 执行状态
  sessionId?: string          // 当前执行使用的 Session
  lastSessionId?: string      // 上次执行的 Session（用于 resume）
  completionOutput?: string   // 最近一次执行的输出摘要

  // 完成后动作
  reviewOnComplete?: boolean  // 完成后自动创建 Human Task 让人确认

  order?: number

  createdAt: string
  updatedAt: string
}

type TaskStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'blocked'

interface AiPromptExecutor {
  kind: 'ai_prompt'
  prompt: string
  agent?: 'claude' | 'codex'
  model?: string
}

interface ScriptExecutor {
  kind: 'script'
  command: string
  workDir?: string
  env?: Record<string, string>
  timeout?: number
}

interface ExecutorOptions {
  continueSession?: boolean       // false = 每次新建 Session（干净上下文）
  customVars?: Record<string, string>
}
```

**变化：**
- 删除 `surface`、`visibleInChat`、`origin`、`originRunId`
- 合并 `createdBy: 'human' | 'ai' | 'system'`
- `sessionId` 明确为"当前执行用的 Session"
- 新增 `originSessionId`（溯源，不做过滤键）
- `reviewOnComplete` 提升为顶层字段
- executor 只保留 `ai_prompt` + `script`，删除 `http`

---

## Session ↔ Task 互转

互转同时支持两种触发方式：用户在前端操作，或 AI 通过 CLI 调用。

### Session → Task

在会话里把当前工作变成一个可调度任务：

```
新建 Task：
  projectId                      = session.projectId
  createdBy                      = 'human' 或 'ai'
  originSessionId                = session.id
  sessionId                      = session.id
  executorOptions.continueSession = true   // 复用这个 Session 的历史上下文
```

API：`POST /api/sessions/:id/create-task`
CLI：`pulse session create-task <sessionId> --title "..." --assignee ai|human`

### Task → Session

为一个任务开启对话上下文：

```
新建 Session：
  projectId    = task.projectId
  createdBy    = 'system'
  sourceTaskId = task.id

更新 Task：
  sessionId = 新建的 session.id
```

API：`POST /api/tasks/:id/create-session`
CLI：`pulse task create-session <taskId> [--name "..."]`

两者通过 `Task.sessionId ↔ Session.sourceTaskId` 互相指向，切换时 `projectId` 是共同锚点。互转时校验 projectId 一致性，不一致返回 400。

---

## AI Task 执行流程

### Session 创建时机（懒加载）

Task 创建时不自动建 Session，第一次 run 时按需创建：

```
Task 被触发执行时：
  if task.sessionId 为空：
    新建 Session：
      projectId    = task.projectId
      createdBy    = 'system'
      sourceTaskId = task.id
    更新 task.sessionId = 新 session.id

  if executorOptions.continueSession = false：
    每次执行都新建一个干净的 Session（不复用历史）
    新建 Session 同上
    更新 task.sessionId = 新 session.id

执行完成后：
  更新 task.lastSessionId = task.sessionId（供下次 resume 参考）
```

### reviewOnComplete（纯通知）

AI Task 完成后，若 `reviewOnComplete = true`，系统创建一个独立的 Human Task 作为通知：

```
创建 Human Task：
  projectId           = task.projectId
  createdBy           = 'system'
  assignee            = 'human'
  kind                = 'once'
  title               = "Review: {task.title}"
  waitingInstructions = "AI task completed. Please review the output."
  originSessionId     = task.sessionId
```

两个 Task 完全独立，无状态依赖。原 AI Task 完成后直接变为 `done`。

### autoRenamePending（自动命名）

Session 创建时 `autoRenamePending = true`。首轮 Run 完成后触发自动命名：

```
if session.autoRenamePending && session 的 Run 数量 === 1：
  调用 AI 生成会话名（基于首轮对话内容）
  更新 session.name = 生成的名字
  更新 session.autoRenamePending = false
```

命名失败不重试，保留默认名称。

---

## 系统提示设计

### 三层注入顺序

```
1. 系统级提示（settings 表中的 global_system_prompt）
2. 项目级提示（project.systemPrompt，包含 project.goal）
3. 执行上下文（session 或 task 的身份信息）
```

### 共用系统说明

所有执行上下文都先注入这段说明：

```
你在 Pulse 系统中运行。

Pulse 的核心概念：
- Project（项目）：工作容器，对应本地文件夹，包含若干会话和任务
- Session（会话）：与 AI 的持续对话，消息历史保存在会话中
- Task（任务）：独立工作单元，可由 AI 或人类执行
- Session 和 Task 均归属于 Project，可互相关联和转换：
    - 会话中可以创建任务（AI 或人类的 todo）
    - AI Task 执行时关联一个 Session 作为上下文
    - Task.originSessionId 记录任务在哪个会话里被创建
    - Session.sourceTaskId 记录会话由哪个任务触发
- 切换上下文时（会话↔任务），用 projectId 作为锚点查全局状态

运行 `pulse commands` 查看所有可用能力。
```

### Session 执行上下文

```
当前上下文：会话

项目: {projectName} ({projectId})
会话: {sessionId}
工作目录: {workDir}

你正在与人类对话。
需要执行独立的自动化工作时，创建 AI Task 而不是在会话里直接完成。
需要人类处理某件事时，创建 Human Task 并填写 waitingInstructions。
```

### Task 执行上下文

```
当前上下文：任务执行

项目: {projectName} ({projectId})
任务: {taskTitle} ({taskId})
会话: {sessionId}
工作目录: {workDir}

你正在执行一个自动化任务。
完成后运行 `pulse task done {taskId} --output "..."` 标记结果。
需要人类介入时，创建 Human Task 并说明原因。
查看任务来源：`pulse task get {taskId}`（originSessionId 字段）。
```

---

## `pulse commands` 接口

### CLI

```bash
pulse commands [--json]
```

### API

```
GET /api/commands
```

### 返回结构

```json
{
  "modules": [
    {
      "name": "session",
      "description": "会话管理",
      "commands": [
        {
          "name": "session list",
          "cli": "pulse session list --project <id> [--json]",
          "api": "GET /api/sessions?projectId=<id>",
          "description": "列出项目下所有会话"
        },
        {
          "name": "session get",
          "cli": "pulse session get <id> [--json]",
          "api": "GET /api/sessions/<id>",
          "description": "获取会话详情"
        },
        {
          "name": "session create",
          "cli": "pulse session create --project <id> --name <name> [--json]",
          "api": "POST /api/sessions",
          "description": "创建新会话"
        }
      ]
    },
    {
      "name": "task",
      "description": "任务管理",
      "commands": [
        {
          "name": "task list",
          "cli": "pulse task list --project <id> [--status pending|running|done] [--assignee ai|human] [--json]",
          "api": "GET /api/tasks?projectId=<id>",
          "description": "列出项目下所有任务"
        },
        {
          "name": "task get",
          "cli": "pulse task get <id> [--json]",
          "api": "GET /api/tasks/<id>",
          "description": "获取任务详情"
        },
        {
          "name": "task create",
          "cli": "pulse task create --project <id> --title <title> --assignee ai|human [--description <desc>] [--json]",
          "api": "POST /api/tasks",
          "description": "创建新任务"
        },
        {
          "name": "task done",
          "cli": "pulse task done <id> --output <summary> [--json]",
          "api": "POST /api/tasks/<id>/done",
          "description": "标记任务完成并记录输出"
        },
        {
          "name": "task run",
          "cli": "pulse task run <id> [--json]",
          "api": "POST /api/tasks/<id>/run",
          "description": "立即触发执行一个 AI Task"
        },
        {
          "name": "task block",
          "cli": "pulse task block <id> --by <blockerId> [--json]",
          "api": "POST /api/tasks/:id/block",
          "description": "设置任务依赖，当前任务等待 blockerId 完成后才能执行"
        },
        {
          "name": "task unblock",
          "cli": "pulse task unblock <id> [--json]",
          "api": "DELETE /api/tasks/:id/block",
          "description": "移除任务的依赖关系"
        }
      ]
    },
    {
      "name": "project",
      "description": "项目管理",
      "commands": [
        {
          "name": "project list",
          "cli": "pulse project list [--json]",
          "api": "GET /api/projects",
          "description": "列出所有项目"
        },
        {
          "name": "project get",
          "cli": "pulse project get <id> [--json]",
          "api": "GET /api/projects/<id>",
          "description": "获取项目详情"
        }
      ]
    },
    {
      "name": "session-task",
      "description": "会话与任务互转",
      "commands": [
        {
          "name": "session create-task",
          "cli": "pulse session create-task <sessionId> --title <title> --assignee ai|human [--json]",
          "api": "POST /api/sessions/:id/create-task",
          "description": "将会话转为任务，复用该会话作为执行上下文"
        },
        {
          "name": "task create-session",
          "cli": "pulse task create-session <taskId> [--name <name>] [--json]",
          "api": "POST /api/tasks/:id/create-session",
          "description": "为任务创建对话会话"
        }
      ]
    },
    {
      "name": "commands",
      "description": "系统",
      "commands": [
        {
          "name": "commands",
          "cli": "pulse commands [--json]",
          "api": "GET /api/commands",
          "description": "列出所有可用命令"
        }
      ]
    }
  ]
}
```

---

## Task 状态机

```
pending  ──(run)──▶  running  ──(success)──▶  done
                        │
                        ├──(fail)──▶  failed
                        │
                        └──(blockedByTaskId 设置)──▶  blocked
                                                          │
                                              (blocker 完成)──▶  pending
```

- `pending → running`：触发执行（AI Task）或等待人处理（Human Task）
- `running → done`：执行成功
- `running → failed`：执行失败
- `pending → blocked`：设置了 `blockedByTaskId`
- `blocked → pending`：blocker Task 完成后自动解除
- `done / failed / cancelled`：终态，不自动流转

---

## 删除的字段汇总

| 字段 | 位置 | 删除原因 |
|------|------|---------|
| `surface` | Task | AI 发明，无实际意义 |
| `visibleInChat` | Task | 与 surface 绑定，一并删除 |
| `origin` | Task | 与 `createdBy` 重复 |
| `originRunId` | Task | 过度细化 |
| `HttpExecutor` | Task | 暂不需要 |

---

## 数据库变更

### sessions 表

```sql
-- 新增
ALTER TABLE sessions ADD COLUMN created_by TEXT NOT NULL DEFAULT 'human';
ALTER TABLE sessions ADD COLUMN source_task_id TEXT REFERENCES tasks(id);
```

### tasks 表

```sql
-- 新增
ALTER TABLE tasks ADD COLUMN origin_session_id TEXT REFERENCES sessions(id);
ALTER TABLE tasks ADD COLUMN review_on_complete INTEGER NOT NULL DEFAULT 0;

-- 删除（SQLite 不支持 DROP COLUMN，通过重建表处理）
-- 删除: surface, visible_in_chat, origin, origin_run_id, executor_options 中的 reviewOnComplete
```

### 索引更新

```sql
-- 删除旧索引
DROP INDEX IF EXISTS idx_tasks_surface;

-- 新增
CREATE INDEX idx_tasks_project_status ON tasks(project_id, status, updated_at DESC);
CREATE INDEX idx_tasks_assignee ON tasks(project_id, assignee, status);
```

---

## 实现步骤

### 第一步：类型定义
- `packages/types/src/session.ts`
  - 新增 `createdBy`、`sourceTaskId`、`followUpQueue: QueuedMessage[]`
  - 导出 `QueuedMessage` 类型
- `packages/types/src/task.ts`
  - 删除 `surface`、`visibleInChat`、`origin`、`originRunId`、`HttpExecutor`
  - 新增顶层 `originSessionId`、`reviewOnComplete`
  - `createdBy` 合并为 `'human' | 'ai' | 'system'`
  - `reviewOnComplete` 从 `ExecutorOptions` 移除

### 第二步：数据库迁移
- `packages/server/src/db/index.ts`
  - sessions 表新增：`created_by TEXT NOT NULL DEFAULT 'human'`、`source_task_id TEXT`
  - tasks 表新增：`origin_session_id TEXT`、`review_on_complete INTEGER NOT NULL DEFAULT 0`
  - tasks 表重建删除：`surface`、`visible_in_chat`、`origin`、`origin_run_id`
  - 更新索引：删除 `idx_tasks_surface`，新增 `idx_tasks_project_status`、`idx_tasks_assignee`

### 第三步：Model 层
- `models/session.ts`：`rowToSession`、`createSession`、`updateSession` 处理新字段
- `models/task.ts`：`rowToTask`、`createTask`、`updateTask` 处理新字段，删除旧字段

### 第四步：服务层
- `services/task-executor.ts`
  - `buildSystemPrompt` 重写为三层（系统级 + 项目级 + 执行上下文），Session 与 Task 上下文分开
  - Task 执行前加 Session 懒加载：`task.sessionId` 为空或 `continueSession=false` 时先创建 Session
- `services/scheduler.ts`
  - `reviewOnComplete` 改读 `task.reviewOnComplete`（顶层）
  - 创建 review Human Task 使用新字段，删除 `surface`/`visibleInChat`/`origin`
- `services/projects.ts`
  - 删除 `surface === 'project'` 过滤，删除 `origin === 'system'` 判断改用 `createdBy`
- `runtime/session-runner.ts`
  - `finalizeRun` 后检查 `autoRenamePending`，调用 AI 生成会话名写回
  - server 启动时恢复未消费的 `followUpQueue`（遍历有队列的 session，重新触发执行）

### 第五步：新增接口
- 新增 `controllers/http/commands.ts` — `GET /api/commands`
- 新增 `controllers/cli/commands.ts` — `pulse commands [--json]`
- `controllers/http/sessions.ts` 新增 `POST /api/sessions/:id/create-task`
- `controllers/http/tasks.ts` 新增 `POST /api/tasks/:id/create-session`、`POST /api/tasks/:id/block`、`DELETE /api/tasks/:id/block`
- `controllers/cli/session.ts` 新增 `pulse session create-task`
- `controllers/cli/task.ts` 新增 `pulse task create-session`、`pulse task block`、`pulse task unblock`

### 第六步：Controller 层清理
- `controllers/http/tasks.ts`：删除 `surface`、`visibleInChat`、`origin`、`originRunId` 字段及过滤参数
- `controllers/cli/task.ts`：删除 `--surface`、`--visible-in-chat`、`--origin` 参数

### 第七步：前端
- `api/client.ts`：删除 `surface`/`visibleInChat` 参数，新增 `createTaskFromSession`、`createSessionFromTask`、`blockTask`、`unblockTask`、`getCommands`
- `views/components/TaskRail.tsx`：删除 `surface`/`visibleInChat` 过滤，Human Task 显示 `waitingInstructions`
- `views/pages/MainPage.tsx`：删除 `surface`、`visibleInChat`、`origin`，改用 `createdBy: 'system'`

### 第八步：测试更新
- 删除所有测试中的 `surface`、`visibleInChat`、`origin` 字段
- 补充新字段的测试用例

---

## 验收标准

**数据结构**
- [x] Task 无 `surface`、`visibleInChat`、`origin`、`originRunId` 字段
- [x] Session 有 `createdBy`、`sourceTaskId`、`followUpQueue`
- [x] Task 有 `originSessionId`、顶层 `reviewOnComplete`，`createdBy` 合并为三值

**执行流程**
- [x] AI Task 第一次 run 时自动创建 Session（懒加载），`continueSession=false` 时每次新建
- [x] `reviewOnComplete=true` 时 AI Task 完成后创建独立 Human Task，原 Task 直接变 done
- [x] `autoRenamePending` 首轮 Run 完成后触发 AI 命名，写回 session.name
- [x] server 重启后 followUpQueue 未消费的消息恢复执行

**接口**
- [x] `GET /api/commands` / `pulse commands` 返回按模块分组的命令列表
- [x] `POST /api/sessions/:id/create-task` 和 `POST /api/tasks/:id/create-session` 可用
- [x] `POST /api/tasks/:id/block` 和 `DELETE /api/tasks/:id/block` 可用
- [x] 互转时校验 projectId 一致性，不一致返回 400

**系统提示**
- [x] 三层注入顺序正确（系统级 → 项目级 → 执行上下文）
- [x] Session 和 Task 的执行上下文提示有明确差异
- [x] 系统提示包含 Pulse 概念说明和 `pulse commands` 入口

**前端**
- [x] TaskRail 无 `surface`/`visibleInChat` 过滤逻辑
- [x] Human Task 在 TaskRail 显示 `waitingInstructions`
- [x] client.ts 新增互转、block/unblock、commands 方法
