export type QuestKind = 'session' | 'task'

export type QuestStatus =
  | 'idle'
  | 'running'
  | 'pending'
  | 'done'
  | 'failed'
  | 'cancelled'

export type QuestCreatedBy = 'human' | 'ai' | 'system'
export type QuestAgent = 'claude' | 'codex'
export type ScheduleKind = 'once' | 'scheduled' | 'recurring'
export type ExecutorKind = 'ai_prompt' | 'script'

export interface QueuedMessage {
  requestId: string
  text: string
  displayText?: string
  promptText?: string
  tool: string
  model: string | null
  effort: string | null
  thinking: boolean
  queuedAt: string
}

export interface ScheduleConfig {
  cron?: string
  runAt?: string
  timezone?: string
  lastRunAt?: string
  nextRunAt?: string
}

export interface AiPromptConfig {
  prompt: string
  agent?: QuestAgent
  model?: string
}

export interface ScriptConfig {
  command: string
  workDir?: string
  env?: Record<string, string>
  timeout?: number
}

export interface ExecutorOptions {
  continueQuest?: boolean
  customVars?: Record<string, string>
  timeout?: number
}

export interface Quest {
  id: string
  projectId: string
  kind: QuestKind
  createdBy: QuestCreatedBy
  createdAt: string
  updatedAt: string

  codexThreadId?: string
  claudeSessionId?: string

  tool?: string
  model?: string
  effort?: string
  thinking?: boolean
  activeRunId?: string

  name?: string
  autoRenamePending?: boolean
  pinned?: boolean
  deleted?: boolean
  deletedAt?: string
  followUpQueue: QueuedMessage[]

  title?: string
  description?: string
  status?: QuestStatus
  enabled?: boolean
  scheduleKind?: ScheduleKind
  scheduleConfig?: ScheduleConfig
  executorKind?: ExecutorKind
  executorConfig?: AiPromptConfig | ScriptConfig
  executorOptions?: ExecutorOptions
  completionOutput?: string
  reviewOnComplete?: boolean
  order?: number
  unread?: boolean
}

export interface CreateQuestInput {
  projectId: string
  kind: QuestKind
  createdBy?: QuestCreatedBy
  tool?: string
  model?: string | null
  effort?: string | null
  thinking?: boolean
  name?: string
  title?: string
  description?: string
  enabled?: boolean
  pinned?: boolean
  deleted?: boolean
  autoRenamePending?: boolean
  scheduleKind?: ScheduleKind
  scheduleConfig?: ScheduleConfig | null
  executorKind?: ExecutorKind
  executorConfig?: AiPromptConfig | ScriptConfig | null
  executorOptions?: ExecutorOptions | null
  reviewOnComplete?: boolean
  order?: number | null
  status?: QuestStatus
  codexThreadId?: string | null
  claudeSessionId?: string | null
}

export interface UpdateQuestInput {
  kind?: QuestKind
  name?: string | null
  title?: string | null
  description?: string | null
  status?: QuestStatus
  enabled?: boolean
  pinned?: boolean
  deleted?: boolean
  autoRenamePending?: boolean
  tool?: string | null
  model?: string | null
  effort?: string | null
  thinking?: boolean
  activeRunId?: string | null
  scheduleKind?: ScheduleKind | null
  scheduleConfig?: ScheduleConfig | null
  executorKind?: ExecutorKind | null
  executorConfig?: AiPromptConfig | ScriptConfig | null
  executorOptions?: ExecutorOptions | null
  completionOutput?: string | null
  reviewOnComplete?: boolean
  order?: number | null
  codexThreadId?: string | null
  claudeSessionId?: string | null
  unread?: boolean
}

export interface MoveQuestInput {
  targetProjectId: string
}

export interface ListQuestsFilter {
  projectId?: string
  kind?: QuestKind
  deleted?: boolean
  status?: QuestStatus
}

export type QuestOpKind =
  | 'created'
  | 'kind_changed'
  | 'project_changed'
  | 'triggered'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'status_changed'
  | 'deleted'

export interface QuestOp {
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
