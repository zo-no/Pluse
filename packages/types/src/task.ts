export type TaskAssignee = 'ai' | 'human'
export type TaskKind = 'once' | 'scheduled' | 'recurring'
export type TaskSurface = 'chat_short' | 'project'
export type TaskOrigin = 'agent' | 'manual' | 'scheduler' | 'system'

export type HumanTaskStatus = 'pending' | 'done' | 'cancelled'
export type AiTaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'blocked'
export type TaskStatus = HumanTaskStatus | AiTaskStatus

export interface ScheduledConfig {
  kind: 'scheduled'
  scheduledAt: string
}

export interface RecurringConfig {
  kind: 'recurring'
  cron: string
  timezone?: string
  lastRunAt?: string
  nextRunAt?: string
}

export type ScheduleConfig = ScheduledConfig | RecurringConfig

export interface ScriptExecutor {
  kind: 'script'
  command: string
  workDir?: string
  env?: Record<string, string>
  timeout?: number
}

export type AgentKind = 'claude' | 'codex'

export interface AiPromptExecutor {
  kind: 'ai_prompt'
  prompt: string
  agent?: AgentKind
  model?: string
}

export interface HttpExecutor {
  kind: 'http'
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  headers?: Record<string, string>
  body?: string
  timeout?: number
}

export type TaskExecutor = ScriptExecutor | AiPromptExecutor | HttpExecutor

export interface VoiceNoticeOptions {
  enabled: boolean
  speechText?: string
}

export interface ExecutorOptions {
  continueSession?: boolean
  customVars?: Record<string, string>
  reviewOnComplete?: boolean
  voiceNotice?: VoiceNoticeOptions
}

export interface Task {
  id: string
  projectId: string
  sessionId?: string
  title: string
  description?: string
  assignee: TaskAssignee
  kind: TaskKind
  status: TaskStatus
  surface: TaskSurface
  visibleInChat: boolean
  origin: TaskOrigin
  originRunId?: string
  order?: number
  scheduleConfig?: ScheduleConfig
  executor?: TaskExecutor
  executorOptions?: ExecutorOptions
  waitingInstructions?: string
  sourceTaskId?: string
  blockedByTaskId?: string
  completionOutput?: string
  enabled: boolean
  createdBy: 'human' | 'ai' | 'system'
  lastSessionId?: string
  createdAt: string
  updatedAt: string
}

export interface CreateTaskInput {
  projectId: string
  sessionId?: string
  title: string
  description?: string
  assignee: TaskAssignee
  kind: TaskKind
  surface: TaskSurface
  visibleInChat: boolean
  origin: TaskOrigin
  originRunId?: string
  order?: number
  scheduleConfig?: ScheduleConfig
  executor?: TaskExecutor
  executorOptions?: ExecutorOptions
  waitingInstructions?: string
  sourceTaskId?: string
  blockedByTaskId?: string
  enabled?: boolean
  createdBy?: 'human' | 'ai' | 'system'
}

export interface UpdateTaskInput {
  title?: string
  description?: string | null
  status?: TaskStatus
  surface?: TaskSurface
  visibleInChat?: boolean
  origin?: TaskOrigin
  originRunId?: string | null
  sessionId?: string | null
  scheduleConfig?: ScheduleConfig | null
  executor?: TaskExecutor | null
  executorOptions?: ExecutorOptions | null
  enabled?: boolean
  completionOutput?: string | null
  blockedByTaskId?: string | null
  lastSessionId?: string | null
}

export interface ListTasksFilter {
  projectId?: string
  sessionId?: string
  kind?: TaskKind
  status?: TaskStatus
  assignee?: TaskAssignee
  surface?: TaskSurface
  visibleInChat?: boolean
}

export interface TaskRun {
  id: string
  taskId: string
  projectId: string
  sessionId?: string
  status: 'running' | 'done' | 'failed' | 'cancelled'
  triggeredBy: 'manual' | 'scheduler' | 'api' | 'cli'
  startedAt: string
  completedAt?: string
  error?: string
}

export interface TaskLog {
  id: string
  taskId: string
  startedAt: string
  completedAt?: string
  status: 'success' | 'failed' | 'cancelled' | 'skipped'
  output?: string
  error?: string
  triggeredBy: 'manual' | 'scheduler' | 'api' | 'cli'
  skipReason?: string
}

export type TaskOpKind =
  | 'created'
  | 'triggered'
  | 'status_changed'
  | 'done'
  | 'cancelled'
  | 'review_created'
  | 'unblocked'
  | 'deleted'

export interface TaskOp {
  id: string
  taskId: string
  op: TaskOpKind
  fromStatus?: string
  toStatus?: string
  actor: 'human' | 'ai' | 'scheduler' | 'system'
  note?: string
  createdAt: string
}
