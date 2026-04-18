import { randomBytes } from 'node:crypto'
import type { Run, CreateRunInput } from '@pluse/types'
import { getDb } from '../db'

function genId(): string {
  return 'run_' + randomBytes(8).toString('hex')
}

function now(): string {
  return new Date().toISOString()
}

type RunRow = {
  id: string
  quest_id: string
  project_id: string
  request_id: string
  trigger: Run['trigger']
  triggered_by: Run['triggeredBy']
  state: string
  failure_reason: string | null
  tool: string
  model: string
  effort: string | null
  thinking: number
  claude_session_id: string | null
  codex_thread_id: string | null
  cancel_requested: number
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
    questId: row.quest_id,
    projectId: row.project_id,
    requestId: row.request_id,
    trigger: row.trigger,
    triggeredBy: row.triggered_by,
    state: row.state as Run['state'],
    failureReason: row.failure_reason ?? undefined,
    tool: row.tool,
    model: row.model,
    effort: row.effort ?? undefined,
    thinking: row.thinking === 1,
    claudeSessionId: row.claude_session_id ?? undefined,
    codexThreadId: row.codex_thread_id ?? undefined,
    cancelRequested: row.cancel_requested === 1,
    runnerProcessId: row.runner_process_id ?? undefined,
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

export function getRunByQuestRequestId(questId: string, requestId: string): Run | null {
  const db = getDb()
  const row = db.query<RunRow, [string, string]>(
    'SELECT * FROM runs WHERE quest_id = ? AND request_id = ? ORDER BY created_at DESC LIMIT 1',
  ).get(questId, requestId)
  return row ? rowToRun(row) : null
}

export function getRunsByQuest(questId: string): Run[] {
  const db = getDb()
  const rows = db.query<RunRow, [string]>(
    'SELECT * FROM runs WHERE quest_id = ? ORDER BY created_at DESC'
  ).all(questId)
  return rows.map(rowToRun)
}

export function getRunsByProject(projectId: string, limit = 20): Run[] {
  const db = getDb()
  const rows = db.query<RunRow, [string, number]>(
    `SELECT *
       FROM runs
      WHERE project_id = ?
      ORDER BY COALESCE(completed_at, started_at, created_at) DESC
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
      id, quest_id, project_id, request_id, trigger, triggered_by,
      state, failure_reason, tool, model, effort, thinking,
      claude_session_id, codex_thread_id,
      cancel_requested, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
    [
      id, input.questId, input.projectId, input.requestId, input.trigger, input.triggeredBy, 'accepted', null,
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
    ['trigger', 'trigger'], ['triggeredBy', 'triggered_by'],
    ['state', 'state'], ['tool', 'tool'], ['model', 'model'], ['effort', 'effort'],
    ['thinking', 'thinking'], ['claudeSessionId', 'claude_session_id'], ['codexThreadId', 'codex_thread_id'],
    ['cancelRequested', 'cancel_requested'],
    ['runnerProcessId', 'runner_process_id'],
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

export function appendRunSpoolLine(runId: string, line: string): void {
  const db = getDb()
  db.run(
    `INSERT INTO run_spool (run_id, ts, line) VALUES (?, ?, ?)`,
    [runId, new Date().toISOString(), line],
  )
}

export function getRunSpool(runId: string): Array<{ id: number; ts: string; line: string }> {
  const db = getDb()
  return db.query<{ id: number; ts: string; line: string }, [string]>(
    `SELECT id, ts, line FROM run_spool WHERE run_id = ? ORDER BY id ASC`,
  ).all(runId)
}
