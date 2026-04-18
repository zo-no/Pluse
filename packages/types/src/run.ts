export type RunTrigger = 'chat' | 'manual' | 'automation'
export type RunTriggeredBy = 'human' | 'scheduler' | 'api' | 'cli'
export type RunState = 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface Run {
  id: string
  questId: string
  projectId: string
  requestId: string

  trigger: RunTrigger
  triggeredBy: RunTriggeredBy
  state: RunState
  failureReason?: string

  tool: string
  model: string
  effort?: string
  thinking: boolean

  claudeSessionId?: string
  codexThreadId?: string

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

export interface CreateRunInput {
  questId: string
  projectId: string
  requestId: string
  trigger: RunTrigger
  triggeredBy: RunTriggeredBy
  tool: string
  model: string
  effort?: string
  thinking?: boolean
  claudeSessionId?: string
  codexThreadId?: string
}
