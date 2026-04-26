import { randomBytes } from 'node:crypto'
import type {
  CreateReminderInput,
  Reminder,
  ReminderPriority,
  ReminderType,
  UpdateReminderInput,
} from '@pluse/types'
import { getDb } from '../db'

function genId(): string {
  return 'rmd_' + randomBytes(8).toString('hex')
}

function now(): string {
  return new Date().toISOString()
}

function getReminderColumns(): Set<string> {
  const db = getDb()
  const rows = db.query<{ name: string }, []>('PRAGMA table_info(reminders)').all()
  return new Set(rows.map((row) => row.name))
}

type ReminderRow = {
  id: string
  project_id: string
  created_by: Reminder['createdBy']
  origin_quest_id: string | null
  origin_run_id: string | null
  type: ReminderType
  title: string
  body: string | null
  remind_at: string | null
  priority: ReminderPriority
  created_at: string
  updated_at: string
}

function rowToReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    projectId: row.project_id,
    createdBy: row.created_by,
    originQuestId: row.origin_quest_id ?? undefined,
    originRunId: row.origin_run_id ?? undefined,
    type: row.type,
    title: row.title,
    body: row.body ?? undefined,
    remindAt: row.remind_at ?? undefined,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listReminders(filter: {
  projectId?: string
  type?: ReminderType
  originQuestId?: string
  originRunId?: string
  priority?: ReminderPriority
  time?: 'all' | 'due' | 'future'
} = {}): Reminder[] {
  const db = getDb()
  const columns = getReminderColumns()
  const conditions: string[] = []
  const params: Array<string | number> = []

  if (columns.has('deleted')) {
    conditions.push('deleted = 0')
  }

  if (filter.projectId) {
    conditions.push('project_id = ?')
    params.push(filter.projectId)
  }
  if (filter.type) {
    conditions.push('type = ?')
    params.push(filter.type)
  }
  if (filter.originQuestId) {
    conditions.push('origin_quest_id = ?')
    params.push(filter.originQuestId)
  }
  if (filter.originRunId) {
    conditions.push('origin_run_id = ?')
    params.push(filter.originRunId)
  }
  if (filter.priority) {
    conditions.push('priority = ?')
    params.push(filter.priority)
  }
  if (filter.time === 'due') {
    conditions.push('(remind_at IS NULL OR remind_at <= ?)')
    params.push(now())
  } else if (filter.time === 'future') {
    conditions.push('remind_at IS NOT NULL AND remind_at > ?')
    params.push(now())
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = db.query<ReminderRow, Array<string | number>>(
    `SELECT * FROM reminders ${where}
      ORDER BY
        CASE WHEN remind_at IS NULL THEN 0 ELSE 1 END ASC,
        remind_at ASC,
        updated_at DESC`,
  ).all(...params)
  return rows.map(rowToReminder)
}

export function getReminder(id: string): Reminder | null {
  const db = getDb()
  const columns = getReminderColumns()
  const row = db.query<ReminderRow, [string]>(
    `SELECT * FROM reminders WHERE id = ?${columns.has('deleted') ? ' AND deleted = 0' : ''}`,
  ).get(id)
  return row ? rowToReminder(row) : null
}

export function createReminder(input: CreateReminderInput): Reminder {
  const db = getDb()
  const id = genId()
  const ts = now()
  const legacyColumns = getReminderColumns()
  const columns = [
    'id', 'project_id', 'created_by', 'origin_quest_id', 'origin_run_id',
    'type', 'title', 'body', 'remind_at', 'priority',
    'created_at', 'updated_at',
  ]
  const values: Array<string | number | null> = [
    id,
    input.projectId,
    input.createdBy ?? 'human',
    input.originQuestId ?? null,
    input.originRunId ?? null,
    input.type ?? 'custom',
    input.title,
    input.body ?? null,
    input.remindAt ?? null,
    input.priority ?? 'normal',
    ts,
    ts,
  ]
  if (legacyColumns.has('tags')) {
    columns.push('tags')
    values.push('[]')
  }
  if (legacyColumns.has('status')) {
    columns.push('status')
    values.push('pending')
  }
  if (legacyColumns.has('read_at')) {
    columns.push('read_at')
    values.push(null)
  }
  if (legacyColumns.has('deleted')) {
    columns.push('deleted')
    values.push(0)
  }
  if (legacyColumns.has('deleted_at')) {
    columns.push('deleted_at')
    values.push(null)
  }
  db.run(
    `INSERT INTO reminders (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    values,
  )
  return getReminder(id)!
}

export function updateReminder(id: string, input: UpdateReminderInput): Reminder {
  const db = getDb()
  const existing = getReminder(id)
  if (!existing) throw new Error(`Reminder not found: ${id}`)

  const sets: string[] = ['updated_at = ?']
  const ts = now()
  const params: Array<string | number | null> = [ts]

  if ('originQuestId' in input) { sets.push('origin_quest_id = ?'); params.push(input.originQuestId ?? null) }
  if ('originRunId' in input) { sets.push('origin_run_id = ?'); params.push(input.originRunId ?? null) }
  if ('type' in input && input.type !== undefined) { sets.push('type = ?'); params.push(input.type) }
  if ('title' in input && input.title !== undefined) { sets.push('title = ?'); params.push(input.title) }
  if ('body' in input) { sets.push('body = ?'); params.push(input.body ?? null) }
  if ('remindAt' in input) { sets.push('remind_at = ?'); params.push(input.remindAt ?? null) }
  if ('priority' in input && input.priority !== undefined) { sets.push('priority = ?'); params.push(input.priority) }

  params.push(id)
  db.run(`UPDATE reminders SET ${sets.join(', ')} WHERE id = ?`, params)
  return getReminder(id)!
}

export function deleteReminder(id: string): boolean {
  const existing = getReminder(id)
  if (!existing) return false
  const db = getDb()
  db.run('DELETE FROM reminders WHERE id = ?', [id])
  return true
}
