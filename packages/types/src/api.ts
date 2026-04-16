// API response wrappers — shared between server routes and web client

export interface ApiOk<T> {
  ok: true
  data: T
}

export interface ApiErr {
  ok: false
  error: string
  code?: string
}

export type ApiResult<T> = ApiOk<T> | ApiErr

// Pagination
export interface PagedResult<T> {
  items: T[]
  total: number
  offset: number
  limit: number
}

// Session event (history)
export type EventType =
  | 'message'
  | 'reasoning'
  | 'tool_use'
  | 'tool_result'
  | 'status'
  | 'file_change'
  | 'usage'

export type EventRole = 'user' | 'assistant'

export interface SessionEvent {
  seq: number
  timestamp: number
  type: EventType
  role?: EventRole
  content?: string       // message / reasoning
  toolInput?: string     // tool_use
  output?: string        // tool_result
  bodyRef?: string
  bodyBytes?: number
  bodyPreview?: string
  bodyTruncated?: boolean
}

// Message submission
export interface SendMessageInput {
  text: string
  requestId?: string
  tool?: string
  model?: string | null
  effort?: string | null
  thinking?: boolean
  attachments?: MessageAttachment[]
}

export interface MessageAttachment {
  type: 'file' | 'image'
  assetId?: string
  name: string
  mimeType: string
}

export interface ProjectOverview {
  project: import('./project').Project
  sessions: import('./session').Session[]
  tasks: import('./task').Task[]
  brainTask: import('./task').Task | null
  waitingTasks: import('./task').Task[]
  projectTasks: import('./task').Task[]
  recentOutputs: ProjectRecentOutput[]
  schedule: {
    lastRunAt?: string
    nextRunAt?: string
  } | null
  counts: {
    sessions: number
    chatShortTasks: number
    projectTasks: number
  }
}

export interface ProjectRecentOutput {
  id: string
  kind: 'session_run' | 'task_run'
  title: string
  status: string
  completedAt?: string
  summary?: string
  sessionId?: string
  taskId?: string
}

// WebSocket invalidation hint
export type WsMessage =
  | { type: 'session_invalidated'; sessionId: string }
  | { type: 'sessions_invalidated'; projectId: string }
  | { type: 'projects_invalidated' }
  | { type: 'run_delta'; runId: string; sessionId: string; delta: unknown }
