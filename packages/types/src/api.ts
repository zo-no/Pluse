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

import type { Project } from './project'
import type { Quest } from './quest'
import type { Todo } from './todo'

// Quest event (history)
export type EventType =
  | 'message'
  | 'reasoning'
  | 'tool_use'
  | 'tool_result'
  | 'status'
  | 'file_change'
  | 'usage'

export type EventRole = 'user' | 'assistant'

export interface QuestEvent {
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
  assetId: string
  filename: string
  savedPath: string
  mimeType: string
}

export interface UploadedAsset {
  id: string
  questId: string
  filename: string
  savedPath: string
  mimeType: string
  sizeBytes: number
  createdAt: string
}

export interface ProjectOverview {
  project: Project
  sessions: Quest[]
  tasks: Quest[]
  todos: Todo[]
  waitingTodos: Todo[]
  recentActivity: ProjectActivityItem[]
  recentOutputs: ProjectRecentOutput[]
  schedule: {
    lastRunAt?: string
    nextRunAt?: string
  } | null
  counts: {
    sessions: number
    tasks: number
    todos: number
  }
}

export type ProjectActivitySubjectType = 'session' | 'task' | 'todo'

export type ProjectActivityOp =
  | 'created'
  | 'kind_changed'
  | 'project_changed_in'
  | 'project_changed_out'
  | 'triggered'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'status_changed'
  | 'deleted'

export interface ProjectActivityItem {
  id: string
  projectId: string
  subjectType: ProjectActivitySubjectType
  subjectId: string
  questId?: string
  title: string
  op: ProjectActivityOp
  actor: 'human' | 'ai' | 'scheduler' | 'system'
  fromKind?: string
  toKind?: string
  fromStatus?: string
  toStatus?: string
  note?: string
  createdAt: string
}

export interface ProjectRecentOutput {
  id: string
  kind: 'chat_run' | 'task_run'
  title: string
  status: string
  completedAt?: string
  summary?: string
  questId?: string
}

export interface TokenUsageSummary {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  runCount: number
  costUsd: number | null
}

export type SseMessage =
  | { type: 'connected'; data: { ts: string } }
  | { type: 'project_opened' | 'project_updated'; data: { projectId: string } }
  | { type: 'domain_updated' | 'domain_deleted'; data: { domainId: string } }
  | { type: 'quest_updated' | 'quest_deleted'; data: { questId: string; projectId: string } }
  | { type: 'todo_updated' | 'todo_deleted'; data: { todoId: string; projectId: string; originQuestId?: string } }
  | { type: 'run_updated'; data: { runId: string; questId: string; projectId: string } }
  | { type: 'run_line'; data: { runId: string; questId: string; projectId: string; line: string; ts: string } }
