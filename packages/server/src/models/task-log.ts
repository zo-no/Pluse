import { randomBytes } from 'node:crypto'
import type { TaskLog } from '@melody-sync/types'
import { getDb } from '../db'

function newId(): string {
  return 'tlog_' + randomBytes(6).toString('hex')
}

export function createTaskLog(input: Omit<TaskLog, 'id'>): TaskLog {
  const db = getDb()
  const id = newId()
  db.run(
    `INSERT INTO task_logs (
      id, task_id, status, triggered_by, output, error, skip_reason, started_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.taskId,
      input.status,
      input.triggeredBy,
      input.output ?? null,
      input.error ?? null,
      input.skipReason ?? null,
      input.startedAt,
      input.completedAt ?? null,
    ],
  )
  return { id, ...input }
}

export function updateTaskLogCompleted(id: string, status: TaskLog['status'], output?: string, error?: string): void {
  const db = getDb()
  db.run(
    `UPDATE task_logs SET status = ?, output = ?, error = ?, completed_at = ? WHERE id = ?`,
    [status, output ?? null, error ?? null, new Date().toISOString(), id],
  )
}

export function getTaskLogs(taskId: string, limit = 20): TaskLog[] {
  const db = getDb()
  return db.query<TaskLog, [string, number]>(
    `SELECT
      id as id,
      task_id as taskId,
      started_at as startedAt,
      completed_at as completedAt,
      status as status,
      output as output,
      error as error,
      triggered_by as triggeredBy,
      skip_reason as skipReason
     FROM task_logs
     WHERE task_id = ?
     ORDER BY started_at DESC
     LIMIT ?`
  ).all(taskId, limit)
}
