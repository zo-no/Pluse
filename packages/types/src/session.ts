export interface Session {
  // identity
  id: string
  projectId: string
  createdAt: string
  updatedAt: string

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
}

export interface CreateSessionInput {
  projectId: string
  name?: string
  tool?: string
  model?: string | null
  effort?: string | null
  thinking?: boolean
  claudeSessionId?: string | null
  codexThreadId?: string | null
}

export interface UpdateSessionInput {
  name?: string
  pinned?: boolean
  archived?: boolean
  tool?: string
  model?: string | null
  effort?: string | null
  thinking?: boolean
  claudeSessionId?: string | null
  codexThreadId?: string | null
  activeRunId?: string | null
  autoRenamePending?: boolean
}
