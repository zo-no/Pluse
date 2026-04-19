import { randomBytes } from 'node:crypto'
import type { ProjectActivityItem } from '@pluse/types'
import { getDb } from '../db'

function genId(): string {
  return 'pact_' + randomBytes(8).toString('hex')
}

export function createProjectActivity(input: Omit<ProjectActivityItem, 'id' | 'createdAt'>): ProjectActivityItem {
  const db = getDb()
  const id = genId()
  const createdAt = new Date().toISOString()
  db.run(
    `INSERT INTO project_activity (
      id, project_id, subject_type, subject_id, quest_id, title, op, actor,
      from_kind, to_kind, from_status, to_status, note, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.projectId,
      input.subjectType,
      input.subjectId,
      input.questId ?? null,
      input.title,
      input.op,
      input.actor,
      input.fromKind ?? null,
      input.toKind ?? null,
      input.fromStatus ?? null,
      input.toStatus ?? null,
      input.note ?? null,
      createdAt,
    ],
  )
  return { id, createdAt, ...input }
}

export function listProjectActivity(projectId: string, limit = 20): ProjectActivityItem[] {
  const db = getDb()
  return db.query<ProjectActivityItem, [string, number]>(
    `SELECT
      id as id,
      project_id as projectId,
      subject_type as subjectType,
      subject_id as subjectId,
      quest_id as questId,
      title as title,
      op as op,
      actor as actor,
      from_kind as fromKind,
      to_kind as toKind,
      from_status as fromStatus,
      to_status as toStatus,
      note as note,
      created_at as createdAt
     FROM project_activity
     WHERE project_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
  ).all(projectId, limit)
}
