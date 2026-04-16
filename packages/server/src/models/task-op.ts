import { randomBytes } from 'node:crypto'
import type { TaskOp } from '@melody-sync/types'
import { getDb } from '../db'

function newId(): string {
  return 'top_' + randomBytes(6).toString('hex')
}

export function createTaskOp(input: Omit<TaskOp, 'id' | 'createdAt'>): TaskOp {
  const db = getDb()
  const id = newId()
  const createdAt = new Date().toISOString()
  db.run(
    `INSERT INTO task_ops (
      id, task_id, op, from_status, to_status, actor, note, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.taskId,
      input.op,
      input.fromStatus ?? null,
      input.toStatus ?? null,
      input.actor,
      input.note ?? null,
      createdAt,
    ],
  )
  return { id, createdAt, ...input }
}

export function getTaskOps(taskId: string, limit = 20): TaskOp[] {
  const db = getDb()
  return db.query<TaskOp, [string, number]>(
    `SELECT
      id as id,
      task_id as taskId,
      op as op,
      from_status as fromStatus,
      to_status as toStatus,
      actor as actor,
      note as note,
      created_at as createdAt
     FROM task_ops
     WHERE task_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(taskId, limit)
}
