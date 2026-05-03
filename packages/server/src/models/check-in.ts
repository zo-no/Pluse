import { randomBytes } from 'node:crypto'
import type {
  CheckIn,
  CheckInCreatedBy,
  CheckInPriority,
  CheckInRecord,
  CreateCheckInInput,
  UpdateCheckInInput,
} from '@pluse/types'
import { getDb } from '../db'

function genCheckInId(): string {
  return 'cin_' + randomBytes(8).toString('hex')
}

function genRecordId(): string {
  return 'chk_' + randomBytes(8).toString('hex')
}

function now(): string {
  return new Date().toISOString()
}

type CheckInRow = {
  id: string
  project_id: string
  created_by: CheckInCreatedBy
  origin_quest_id: string | null
  origin_run_id: string | null
  title: string
  body: string | null
  remind_at: string | null
  priority: CheckInPriority
  created_at: string
  updated_at: string
}

type CheckInRecordRow = {
  id: string
  project_id: string
  check_in_id: string
  origin_quest_id: string | null
  origin_run_id: string | null
  title: string
  body: string | null
  remind_at: string | null
  checked_at: string
  created_by: CheckInCreatedBy
  note: string | null
  created_at: string
  updated_at: string
}

type CreateCheckInRecordInput = {
  projectId: string
  checkInId: string
  originQuestId?: string | null
  originRunId?: string | null
  title: string
  body?: string | null
  remindAt?: string | null
  createdBy?: CheckInCreatedBy
  note?: string | null
}

export type CheckInListFilter = {
  projectId?: string
  originQuestId?: string
  originRunId?: string
  priority?: CheckInPriority
  time?: 'all' | 'due' | 'future'
}

export type CheckInRecordListFilter = {
  projectId?: string
  checkInId?: string
  originQuestId?: string
  originRunId?: string
}

function rowToCheckIn(row: CheckInRow): CheckIn {
  return {
    id: row.id,
    projectId: row.project_id,
    createdBy: row.created_by,
    originQuestId: row.origin_quest_id ?? undefined,
    originRunId: row.origin_run_id ?? undefined,
    title: row.title,
    body: row.body ?? undefined,
    remindAt: row.remind_at ?? undefined,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToCheckInRecord(row: CheckInRecordRow): CheckInRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    checkInId: row.check_in_id,
    originQuestId: row.origin_quest_id ?? undefined,
    originRunId: row.origin_run_id ?? undefined,
    title: row.title,
    body: row.body ?? undefined,
    remindAt: row.remind_at ?? undefined,
    checkedAt: row.checked_at,
    createdBy: row.created_by,
    note: row.note ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listCheckIns(filter: CheckInListFilter = {}): CheckIn[] {
  const db = getDb()
  const conditions: string[] = []
  const params: Array<string | number> = []

  if (filter.projectId) {
    conditions.push('project_id = ?')
    params.push(filter.projectId)
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
  const rows = db.query<CheckInRow, Array<string | number>>(
    `SELECT * FROM check_ins ${where}
      ORDER BY
        CASE WHEN remind_at IS NULL THEN 0 ELSE 1 END ASC,
        remind_at ASC,
        updated_at DESC`,
  ).all(...params)
  return rows.map(rowToCheckIn)
}

export function getCheckIn(id: string): CheckIn | null {
  const db = getDb()
  const row = db.query<CheckInRow, [string]>(
    'SELECT * FROM check_ins WHERE id = ?',
  ).get(id)
  return row ? rowToCheckIn(row) : null
}

export function createCheckIn(input: CreateCheckInInput): CheckIn {
  const db = getDb()
  const id = genCheckInId()
  const ts = now()
  db.run(
    `INSERT INTO check_ins (
      id, project_id, created_by, origin_quest_id, origin_run_id,
      title, body, remind_at, priority, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.projectId,
      input.createdBy ?? 'human',
      input.originQuestId ?? null,
      input.originRunId ?? null,
      input.title,
      input.body ?? null,
      input.remindAt ?? null,
      input.priority ?? 'normal',
      ts,
      ts,
    ],
  )
  return getCheckIn(id)!
}

export function updateCheckIn(id: string, input: UpdateCheckInInput): CheckIn {
  const db = getDb()
  const existing = getCheckIn(id)
  if (!existing) throw new Error(`Check-in not found: ${id}`)

  const sets: string[] = ['updated_at = ?']
  const ts = now()
  const params: Array<string | number | null> = [ts]

  if ('originQuestId' in input) { sets.push('origin_quest_id = ?'); params.push(input.originQuestId ?? null) }
  if ('originRunId' in input) { sets.push('origin_run_id = ?'); params.push(input.originRunId ?? null) }
  if ('title' in input && input.title !== undefined) { sets.push('title = ?'); params.push(input.title) }
  if ('body' in input) { sets.push('body = ?'); params.push(input.body ?? null) }
  if ('remindAt' in input) { sets.push('remind_at = ?'); params.push(input.remindAt ?? null) }
  if ('priority' in input && input.priority !== undefined) { sets.push('priority = ?'); params.push(input.priority) }

  params.push(id)
  db.run(`UPDATE check_ins SET ${sets.join(', ')} WHERE id = ?`, params)
  return getCheckIn(id)!
}

export function deleteCheckIn(id: string): boolean {
  const existing = getCheckIn(id)
  if (!existing) return false
  const db = getDb()
  db.run('DELETE FROM check_ins WHERE id = ?', [id])
  return true
}

export function createCheckInRecord(input: CreateCheckInRecordInput): CheckInRecord {
  const db = getDb()
  const id = genRecordId()
  const ts = now()
  db.run(
    `INSERT INTO check_in_records (
      id, project_id, check_in_id, origin_quest_id, origin_run_id,
      title, body, remind_at, checked_at, created_by, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.projectId,
      input.checkInId,
      input.originQuestId ?? null,
      input.originRunId ?? null,
      input.title,
      input.body ?? null,
      input.remindAt ?? null,
      ts,
      input.createdBy ?? 'human',
      input.note ?? null,
      ts,
      ts,
    ],
  )
  return getCheckInRecord(id)!
}

export function getCheckInRecord(id: string): CheckInRecord | null {
  const db = getDb()
  const row = db.query<CheckInRecordRow, [string]>(
    'SELECT * FROM check_in_records WHERE id = ?',
  ).get(id)
  return row ? rowToCheckInRecord(row) : null
}

export function listCheckInRecords(filter: CheckInRecordListFilter = {}): CheckInRecord[] {
  const db = getDb()
  const conditions: string[] = []
  const params: string[] = []

  if (filter.projectId) {
    conditions.push('project_id = ?')
    params.push(filter.projectId)
  }
  if (filter.checkInId) {
    conditions.push('check_in_id = ?')
    params.push(filter.checkInId)
  }
  if (filter.originQuestId) {
    conditions.push('origin_quest_id = ?')
    params.push(filter.originQuestId)
  }
  if (filter.originRunId) {
    conditions.push('origin_run_id = ?')
    params.push(filter.originRunId)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = db.query<CheckInRecordRow, string[]>(
    `SELECT * FROM check_in_records ${where}
      ORDER BY checked_at DESC, created_at DESC`,
  ).all(...params)
  return rows.map(rowToCheckInRecord)
}
