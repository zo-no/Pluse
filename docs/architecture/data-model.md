# Pluse 数据模型

> 正式口径，由 0003-quest-unified-model.md 收敛而来。

---

## Project

```typescript
interface Project {
  id: string           // 'proj_' + hex
  name: string
  workDir: string      // 本地文件夹绝对路径
  goal?: string
  systemPrompt?: string
  createdAt: string
  updatedAt: string
}
```

---

## Quest

AI 工作的统一容器，有 `kind` 字段区分 session / task 态，互斥可切换。

```typescript
type QuestKind = 'session' | 'task'

type QuestStatus =
  | 'idle'       // session 态默认值（task 态不使用 idle）
  | 'running'    // 有活跃 run
  | 'pending'    // task 态：等待下次调度
  | 'done'       // task 态：once 任务完成
  | 'failed'     // task 态：最近一次执行失败
  | 'cancelled'  // task 态：已取消

interface Quest {
  id: string           // 'qst_' + hex
  projectId: string
  kind: QuestKind
  createdBy: 'human' | 'ai' | 'system'

  // Provider 上下文标识（不是 Quest 主键，kind 切换时保留）
  codexThreadId?: string
  claudeSessionId?: string

  // 运行时偏好（共用）
  tool?: string        // 'claude' | 'codex'
  model?: string
  effort?: 'low' | 'medium' | 'high'
  thinking?: boolean
  activeRunId?: string

  // session 态字段
  name?: string
  autoRenamePending?: boolean
  pinned?: boolean
  deleted?: boolean      // 归档（软删除），默认不出现在 active 列表
  deletedAt?: string
  followUpQueue?: QueuedMessage[]

  // task 态字段（kind 切换时保留，不清空）
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
  reviewOnComplete?: boolean   // 完成后创建 Todo 通知人，纯人工标记完成
  order?: number

  createdAt: string
  updatedAt: string
}

interface QueuedMessage {
  requestId: string
  text: string
  tool: string
  model: string | null
  effort: 'low' | 'medium' | 'high' | null
  thinking: boolean
  queuedAt: string
}

interface ScheduleConfig {
  cron?: string        // scheduled/recurring 使用
  runAt?: string       // once 使用，ISO 8601 UTC
  timezone?: string
}

interface AiPromptConfig {
  prompt: string
  agent?: 'claude' | 'codex'   // 不指定则使用 Quest.tool
  model?: string
}

interface ScriptConfig {
  command: string
  workDir?: string
  env?: Record<string, string>
  timeout?: number     // 秒，默认 300
}

interface ExecutorOptions {
  continueQuest?: boolean      // false = 每次用新 AI 上下文，默认 true
  customVars?: Record<string, string>
}
```

---

## Todo

独立人工待办，不是 Quest 的子对象。AI 通过 API/CLI 主动查询，不做事件推送。

```typescript
interface Todo {
  id: string           // 'todo_' + hex
  projectId: string
  createdBy: 'human' | 'ai' | 'system'
  originQuestId?: string       // 溯源，可选

  title: string
  description?: string         // 详细说明
  waitingInstructions?: string // 给人的操作指引（AI 创建时填写）

  status: 'pending' | 'done' | 'cancelled'
  deleted?: boolean
  deletedAt?: string

  createdAt: string
  updatedAt: string
}
```

**`description` vs `waitingInstructions`：**
- `description`：说明这个 Todo 是什么，背景信息
- `waitingInstructions`：告诉人具体要做什么操作，AI 创建时填写

**归档语义：**
- 所有用户“删除”动作统一视为归档
- `deleted=false` 的 Quest/Todo 出现在 active 列表
- `deleted=true` 的 Quest/Todo 只在归档区展示，可恢复

---

## Run

统一执行记录，涵盖 chat / manual / automation 三种触发来源。

```typescript
type RunTrigger = 'chat' | 'manual' | 'automation'

type RunState =
  | 'accepted'    // 已创建，等待子进程启动
  | 'running'     // 子进程执行中
  | 'completed'   // 正常完成
  | 'failed'      // 执行失败（含超时）
  | 'cancelled'   // 用户取消

interface Run {
  id: string           // 'run_' + hex
  questId: string
  projectId: string
  requestId: string    // 幂等键

  trigger: RunTrigger
  triggeredBy: 'human' | 'scheduler' | 'api' | 'cli'

  state: RunState
  failureReason?: string   // state='failed' 时：'timeout' | 'process_lost' | 'error' | ...

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

**`state` 语义：**
- `completed` = 子进程正常退出（exit code 0）
- `failed` = 子进程异常退出、超时、或服务重启后进程丢失
- `cancelled` = 用户主动取消

去掉 `result` 字段，`state` 本身已足够区分结果，失败原因用 `failureReason` 描述。

---

## QuestOp

记录 Quest 的所有状态变更，用于审计和调试。

```typescript
type QuestOpKind =
  | 'created'
  | 'kind_changed'    // session ↔ task 切换
  | 'triggered'       // task 态被触发执行
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'status_changed'
  | 'deleted'         // 归档

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

## 模型关系图

```
Project (1)
  ├── Quest (n)
  │     ├── Run (n)
  │     └── QuestOp (n)
  └── Todo (n)
        └── originQuestId → Quest (optional)
```
