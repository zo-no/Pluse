import { randomBytes } from 'node:crypto'
import type {
  CreateNotificationInput,
  Notification,
  NotificationStatus,
  NotificationType,
  UpdateNotificationInput,
} from '@pluse/types'
import { getDb } from '../db'

function genId(): string {
  return 'ntf_' + randomBytes(8).toString('hex')
}

function now(): string {
  return new Date().toISOString()
}

type NotificationRow = {
  id: string
  project_id: string
  created_by: Notification['createdBy']
  origin_quest_id: string | null
  origin_run_id: string | null
  type: NotificationType
  title: string
  body: string | null
  status: NotificationStatus
  deleted: number
  deleted_at: string | null
  created_at: string
  updated_at: string
}

function rowToNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    projectId: row.project_id,
    createdBy: row.created_by,
    originQuestId: row.origin_quest_id ?? undefined,
    originRunId: row.origin_run_id ?? undefined,
    type: row.type,
    title: row.title,
    body: row.body ?? undefined,
    status: row.status,
    deleted: row.deleted === 1 ? true : undefined,
    deletedAt: row.deleted_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listNotifications(filter: {
  projectId?: string
  status?: NotificationStatus
  deleted?: boolean
  type?: NotificationType
  originQuestId?: string
} = {}): Notification[] {
  const db = getDb()
  const conditions: string[] = []
  const params: Array<string | number> = []

  if (filter.projectId) {
    conditions.push('project_id = ?')
    params.push(filter.projectId)
  }
  if (filter.status) {
    conditions.push('status = ?')
    params.push(filter.status)
  }
  if (filter.deleted !== undefined) {
    conditions.push('deleted = ?')
    params.push(filter.deleted ? 1 : 0)
  }
  if (filter.type) {
    conditions.push('type = ?')
    params.push(filter.type)
  }
  if (filter.originQuestId) {
    conditions.push('origin_quest_id = ?')
    params.push(filter.originQuestId)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = db.query<NotificationRow, Array<string | number>>(
    `SELECT * FROM notifications ${where}
      ORDER BY
        status = 'unread' DESC,
        updated_at DESC`,
  ).all(...params)
  return rows.map(rowToNotification)
}

export function getNotification(id: string): Notification | null {
  const db = getDb()
  const row = db.query<NotificationRow, [string]>('SELECT * FROM notifications WHERE id = ?').get(id)
  return row ? rowToNotification(row) : null
}

export function createNotification(input: CreateNotificationInput): Notification {
  const db = getDb()
  const id = genId()
  const ts = now()
  db.run(
    `INSERT INTO notifications (
      id, project_id, created_by, origin_quest_id, origin_run_id,
      type, title, body, status, deleted, deleted_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.projectId,
      input.createdBy ?? 'system',
      input.originQuestId ?? null,
      input.originRunId ?? null,
      input.type,
      input.title,
      input.body ?? null,
      input.status ?? 'unread',
      input.deleted ? 1 : 0,
      input.deleted ? ts : null,
      ts,
      ts,
    ],
  )
  return getNotification(id)!
}

export function updateNotification(id: string, input: UpdateNotificationInput): Notification {
  const db = getDb()
  const existing = getNotification(id)
  if (!existing) throw new Error(`Notification not found: ${id}`)

  const sets: string[] = ['updated_at = ?']
  const ts = now()
  const params: Array<string | number | null> = [ts]

  if ('title' in input && input.title !== undefined) {
    sets.push('title = ?')
    params.push(input.title)
  }
  if ('body' in input) {
    sets.push('body = ?')
    params.push(input.body ?? null)
  }
  if ('status' in input && input.status !== undefined) {
    sets.push('status = ?')
    params.push(input.status)
  }
  if ('deleted' in input && input.deleted !== undefined) {
    sets.push('deleted = ?')
    params.push(input.deleted ? 1 : 0)
    sets.push('deleted_at = ?')
    params.push(input.deleted ? ts : null)
  }

  params.push(id)
  db.run(`UPDATE notifications SET ${sets.join(', ')} WHERE id = ?`, params)
  return getNotification(id)!
}

export function deleteNotification(id: string): boolean {
  const existing = getNotification(id)
  if (!existing) return false
  updateNotification(id, { deleted: true })
  return true
}
