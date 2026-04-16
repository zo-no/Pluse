import { randomBytes } from 'node:crypto'
import type { TaskRun } from '@melody-sync/types'
import { getDb } from '../db'

function newId(): string {
  return 'trun_' + randomBytes(6).toString('hex')
}

function rowToTaskRun(row: Record<string, unknown>): TaskRun {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    projectId: row.project_id as string,
    sessionId: (row.session_id as string) ?? undefined,
    status: row.status as TaskRun['status'],
    triggeredBy: row.triggered_by as TaskRun['triggeredBy'],
    startedAt: row.started_at as string,
    completedAt: (row.completed_at as string) ?? undefined,
    error: (row.error as string) ?? undefined,
  }
}

export function createTaskRun(taskId: string, projectId: string, triggeredBy: TaskRun['triggeredBy'], sessionId?: string): TaskRun {
  const db = getDb()
  const id = newId()
  const startedAt = new Date().toISOString()
  db.run(
    `INSERT INTO task_runs (id, task_id, project_id, session_id, status, triggered_by, started_at)
     VALUES (?, ?, ?, ?, 'running', ?, ?)`,
    [id, taskId, projectId, sessionId ?? null, triggeredBy, startedAt],
  )
  return { id, taskId, projectId, sessionId, status: 'running', triggeredBy, startedAt }
}

export function completeTaskRun(id: string, status: TaskRun['status'], error?: string, sessionId?: string): void {
  const db = getDb()
  db.run(
    `UPDATE task_runs
       SET status = ?, error = ?, session_id = COALESCE(?, session_id), completed_at = ?
     WHERE id = ?`,
    [status, error ?? null, sessionId ?? null, new Date().toISOString(), id],
  )
}

export function appendSpoolLine(runId: string, line: string): void {
  const db = getDb()
  db.run(
    `INSERT INTO task_run_spool (run_id, ts, line) VALUES (?, ?, ?)`,
    [runId, new Date().toISOString(), line],
  )
}

export function getTaskRuns(taskId: string, limit = 20): TaskRun[] {
  const db = getDb()
  const rows = db.query(
    `SELECT * FROM task_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT ?`
  ).all(taskId, limit) as Record<string, unknown>[]
  return rows.map(rowToTaskRun)
}

export function getTaskRunsByProject(projectId: string, limit = 20): TaskRun[] {
  const db = getDb()
  const rows = db.query(
    `SELECT *
       FROM task_runs
      WHERE project_id = ?
      ORDER BY COALESCE(completed_at, started_at) DESC
      LIMIT ?`,
  ).all(projectId, limit) as Record<string, unknown>[]
  return rows.map(rowToTaskRun)
}
