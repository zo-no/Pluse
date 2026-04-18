import { randomBytes } from 'node:crypto'
import type { QuestOp } from '@pluse/types'
import { getDb } from '../db'

function genId(): string {
  return 'qop_' + randomBytes(8).toString('hex')
}

export function createQuestOp(input: Omit<QuestOp, 'id' | 'createdAt'>): QuestOp {
  const db = getDb()
  const id = genId()
  const createdAt = new Date().toISOString()
  db.run(
    `INSERT INTO quest_ops (
      id, quest_id, op, from_kind, to_kind, from_status, to_status, actor, note, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.questId,
      input.op,
      input.fromKind ?? null,
      input.toKind ?? null,
      input.fromStatus ?? null,
      input.toStatus ?? null,
      input.actor,
      input.note ?? null,
      createdAt,
    ],
  )
  return { id, createdAt, ...input }
}

export function getQuestOps(questId: string, limit = 20): QuestOp[] {
  const db = getDb()
  return db.query<QuestOp, [string, number]>(
    `SELECT
      id as id,
      quest_id as questId,
      op as op,
      from_kind as fromKind,
      to_kind as toKind,
      from_status as fromStatus,
      to_status as toStatus,
      actor as actor,
      note as note,
      created_at as createdAt
     FROM quest_ops
     WHERE quest_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
  ).all(questId, limit)
}
