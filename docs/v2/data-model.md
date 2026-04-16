# 数据模型

## Project（项目）

Project 是会话的容器，映射到本地文件系统的一个文件夹。

```typescript
interface Project {
  id: string           // 'proj_' + hex
  name: string         // 显示名称
  path: string         // 本地文件夹绝对路径，e.g. '/Users/foo/my-project'
  systemPrompt?: string // 注入给 AI 的项目级提示词
  createdAt: string
  updatedAt: string
}
```

**Project 的职责：**
- 持有本地文件夹路径（Claude CLI 的工作目录）
- 持有项目级 system prompt（每次执行时注入）
- 作为 Session 的归属容器

**Project 不负责：**
- 不管理文件夹内的文件（只是映射，不做 watch 或索引）
- 不做任务调度

---

## Session（会话）

Session 是 Project 下的一个持久对话容器。

```typescript
interface Session {
  id: string              // 'sess_' + hex
  projectId: string       // 所属 Project

  name: string
  autoRenamePending?: boolean  // 首条消息后 AI 自动命名

  // 运行时偏好（持久化，作为该会话的默认值）
  model?: string
  effort?: string
  thinking?: boolean

  // 执行状态
  activeRunId?: string    // 当前正在执行的 Run id

  pinned?: boolean
  archived?: boolean
  archivedAt?: string

  createdAt: string
  updatedAt: string
}
```

**Session 的职责：**
- 持有会话身份和项目归属
- 持有会话级运行偏好（model / effort / thinking）
- 指向当前活跃执行（activeRunId）
- 作为 session_events 的宿主

**Session 不负责：**
- 不存储对话内容（内容在 session_events）
- 不管理 follow-up queue 的具体内容（Run 完成后自动取下一条）

---

## Run（执行）

Run 是 Session 内一次消息的具体执行过程。

```typescript
interface Run {
  id: string              // 'run_' + hex
  sessionId: string
  requestId: string       // 幂等键，防止重复提交

  state: RunState
  result?: RunResult
  failureReason?: string

  model: string
  effort?: string
  thinking: boolean

  cancelRequested: boolean
  runnerProcessId?: number  // fork 出的子进程 PID

  contextInputTokens?: number
  contextWindowTokens?: number

  createdAt: string
  startedAt?: string
  updatedAt: string
  completedAt?: string
  finalizedAt?: string     // spool 归一化写入 session_events 完成时间
}

type RunState = 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled'
type RunResult = 'success' | 'error' | 'cancelled'
```

---

## SessionEvent（会话事件）

session_events 是会话历史的**唯一真值**（canonical truth）。

```typescript
interface SessionEvent {
  id: string
  sessionId: string
  seq: number             // 单调递增，1-indexed
  timestamp: number       // Unix 毫秒

  type: EventType
  role?: 'user' | 'assistant'

  // body 字段：小内容 inline，大内容外部化
  content?: string        // message / reasoning / template_context
  toolInput?: string      // tool_use
  output?: string         // tool_result

  bodyRef?: string        // 外部化时的文件引用
  bodyBytes?: number
  bodyPreview?: string    // 外部化时的预览截断
  bodyTruncated?: boolean

  createdAt: string
}

type EventType =
  | 'message'          // user 或 assistant 文本
  | 'reasoning'        // extended thinking（折叠展示）
  | 'tool_use'         // 工具调用请求
  | 'tool_result'      // 工具调用结果
  | 'status'           // 运行状态变化
  | 'file_change'      // 文件变更
  | 'usage'            // token 用量
```

**Body 外部化规则：**

| 事件类型 | inline 上限 | 超出处理 |
|---|---|---|
| message | 64 KB | 外部化到 bodies/<ref>.txt |
| reasoning | 0（始终外部化） | bodies/<ref>.txt |
| tool_use | 2 KB | 外部化 |
| tool_result | 4 KB | 外部化 |

**预览截断长度（外部化时保留的 preview）：**

| 事件类型 | 预览长度 |
|---|---|
| message / reasoning | 1600 字符 |
| tool_use | 800 字符 |
| tool_result | 1200 字符 |

---

## 模型关系

```
Project (1)
  └── Session (n)
        └── Run (n)          — 每条消息一个 Run
        └── SessionEvent (n) — 完整对话历史（canonical truth）
```

Run 完成后，spool.jsonl 中的原始输出被归一化写入 session_events，之后 spool 文件可按保留策略清理。
