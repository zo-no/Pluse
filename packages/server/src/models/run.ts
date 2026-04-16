import { randomBytes } from 'node:crypto'
import type { Run, CreateRunInput } from '@melody-sync/types'
import { getDb } from '../db'

function genId(): string {
  return 'run_' + randomBytes(8).toString('hex')
}

function now(): string {
  return new Date().toISOString()
}

type RunRow = {
  id: string
  session_id: string
  request_id: string
  state: string
  tool: string
  model: string
  effort: string | null
  thinking: number
  claude_session_id: string | null
  codex_thread_id: string | null
  cancel_requested: number
  result: string | null
  failure_reason: string | null
  runner_process_id: number | null
  context_input_tokens: number | null
  context_window_tokens: number | null
  created_at: string
  started_at: string | null
  updated_at: string
  completed_at: string | null
  finalized_at: string | null
}

function rowToRun(row: RunRow): Run {
  return {
    id: row.id,
    sessionId: row.session_id,
    requestId: row.request_id,
    state: row.state as Run['state'],
    tool: row.tool,
    model: row.model,
    effort: row.effort ?? undefined,
    thinking: row.thinking === 1,
    claudeSessionId: row.claude_session_id ?? undefined,
    codexThreadId: row.codex_thread_id ?? undefined,
    cancelRequested: row.cancel_requested === 1,
    runnerProcessId: row.runner_process_id ?? undefined,
    result: (row.result as Run['result']) ?? undefined,
    failureReason: row.failure_reason ?? undefined,
    contextInputTokens: row.context_input_tokens ?? undefined,
    contextWindowTokens: row.context_window_tokens ?? undefined,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
    finalizedAt: row.finalized_at ?? undefined,
  }
}

// ─── public API ───────────────────────────────────────────────────────────────

export function getRun(id: string): Run | null {
  const db = getDb()
  const row = db.query<RunRow, [string]>(
    'SELECT * FROM runs WHERE id = ?'
  ).get(id)
  return row ? rowToRun(row) : null
}

export function getRunsBySession(sessionId: string): Run[] {
  const db = getDb()
  const rows = db.query<RunRow, [string]>(
    'SELECT * FROM runs WHERE session_id = ? ORDER BY created_at DESC'
  ).all(sessionId)
  return rows.map(rowToRun)
}

export function getRunsByProject(projectId: string, limit = 20): Run[] {
  const db = getDb()
  const rows = db.query<RunRow, [string, number]>(
    `SELECT runs.*
       FROM runs
       INNER JOIN sessions ON sessions.id = runs.session_id
      WHERE sessions.project_id = ?
      ORDER BY COALESCE(runs.completed_at, runs.started_at, runs.created_at) DESC
      LIMIT ?`,
  ).all(projectId, limit)
  return rows.map(rowToRun)
}

export function createRun(input: CreateRunInput): Run {
  const db = getDb()
  const id = genId()
  const ts = now()

  db.run(
    `INSERT INTO runs (
      id, session_id, request_id, state, tool, model, effort, thinking,
      claude_session_id, codex_thread_id,
      cancel_requested, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?)`,
    [
      id, input.sessionId, input.requestId, 'accepted',
      input.tool, input.model, input.effort ?? null, input.thinking ? 1 : 0,
      input.claudeSessionId ?? null, input.codexThreadId ?? null,
      ts, ts,
    ]
  )

  return getRun(id)!
}

export function updateRun(id: string, patch: Partial<Run>): Run {
  const existing = getRun(id)
  if (!existing) throw new Error(`Run not found: ${id}`)

  const db = getDb()
  const ts = now()
  const fieldMap: Array<[keyof Run, string]> = [
    ['state', 'state'], ['tool', 'tool'], ['model', 'model'], ['effort', 'effort'],
    ['thinking', 'thinking'], ['claudeSessionId', 'claude_session_id'], ['codexThreadId', 'codex_thread_id'],
    ['cancelRequested', 'cancel_requested'],
    ['runnerProcessId', 'runner_process_id'], ['result', 'result'],
    ['failureReason', 'failure_reason'],
    ['contextInputTokens', 'context_input_tokens'],
    ['contextWindowTokens', 'context_window_tokens'],
    ['startedAt', 'started_at'], ['completedAt', 'completed_at'],
    ['finalizedAt', 'finalized_at'],
  ]

  const sets: string[] = ['updated_at = ?']
  const params: (string | number | null)[] = [ts]

  for (const [key, col] of fieldMap) {
    if (key in patch) {
      sets.push(`${col} = ?`)
      const val = patch[key]
      params.push(typeof val === 'boolean' ? (val ? 1 : 0) : (val ?? null) as string | number | null)
    }
  }

  params.push(id)
  db.run(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`, params)
  return getRun(id)!
}

export function cancelRun(id: string): Run {
  return updateRun(id, { cancelRequested: true })
}
