export type RunState = 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled'
export type RunResult = 'success' | 'error' | 'cancelled'

export interface Run {
  id: string
  sessionId: string
  requestId: string

  state: RunState
  tool: string
  model: string
  effort?: string
  thinking: boolean
  claudeSessionId?: string
  codexThreadId?: string

  createdAt: string
  startedAt?: string
  updatedAt: string
  completedAt?: string
  finalizedAt?: string

  cancelRequested: boolean

  runnerProcessId?: number

  result?: RunResult
  failureReason?: string

  contextInputTokens?: number
  contextWindowTokens?: number
}

export interface CreateRunInput {
  sessionId: string
  requestId: string
  tool: string
  model: string
  effort?: string
  thinking?: boolean
  claudeSessionId?: string
  codexThreadId?: string
}
