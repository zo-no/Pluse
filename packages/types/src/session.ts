export interface QueuedMessage {
  requestId: string
  text: string
  tool: string
  model: string | null
  effort: string | null
  thinking: boolean
}

export interface Session {
  // identity
  id: string
  projectId: string
  createdAt: string
  updatedAt: string

  // source
  createdBy: 'human' | 'ai' | 'system'
  sourceTaskId?: string

  // display
  name: string
  autoRenamePending?: boolean
  pinned?: boolean
  archived?: boolean
  archivedAt?: string

  // runtime preferences
  tool?: string
  model?: string
  effort?: string
  thinking?: boolean
  claudeSessionId?: string
  codexThreadId?: string

  // run lifecycle
  activeRunId?: string

  // message queue (buffered while a run is active)
  followUpQueue: QueuedMessage[]
}

export interface CreateSessionInput {
  projectId: string
  name?: string
  createdBy?: 'human' | 'ai' | 'system'
  sourceTaskId?: string
  tool?: string
  model?: string | null
  effort?: string | null
  thinking?: boolean
  claudeSessionId?: string | null
  codexThreadId?: string | null
}

export interface UpdateSessionInput {
  name?: string
  autoRenamePending?: boolean
  pinned?: boolean
  archived?: boolean
  tool?: string
  model?: string | null
  effort?: string | null
  thinking?: boolean
  claudeSessionId?: string | null
  codexThreadId?: string | null
  activeRunId?: string | null
  sourceTaskId?: string | null
}
