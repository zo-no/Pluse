import { randomBytes } from 'node:crypto'
import type {
  CreateTaskInput,
  ExecutorOptions,
  ListTasksFilter,
  ScheduleConfig,
  Task,
  TaskAssignee,
  TaskExecutor,
  TaskKind,
  TaskStatus,
  UpdateTaskInput,
} from '@melody-sync/types'
import { getDb } from '../db'

type SqlValue = string | number | bigint | boolean | Uint8Array | null

function newId(): string {
  return 'task_' + randomBytes(6).toString('hex')
}

function now(): string {
  return new Date().toISOString()
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    createdBy: ((row.created_by as string) ?? 'human') as Task['createdBy'],
    originSessionId: (row.origin_session_id as string) ?? undefined,
    sessionId: (row.session_id as string) ?? undefined,
    title: row.title as string,
    description: (row.description as string) ?? undefined,
    assignee: row.assignee as TaskAssignee,
    kind: row.kind as TaskKind,
    status: row.status as TaskStatus,
    order: (row.order_index as number) ?? undefined,
    scheduleConfig: row.schedule_config
      ? JSON.parse(row.schedule_config as string) as ScheduleConfig
      : undefined,
    executor: row.executor_kind && row.executor_config
      ? { kind: row.executor_kind, ...JSON.parse(row.executor_config as string) } as TaskExecutor
      : undefined,
    executorOptions: row.executor_options
      ? JSON.parse(row.executor_options as string) as ExecutorOptions
      : undefined,
    waitingInstructions: (row.waiting_instructions as string) ?? undefined,
    blockedByTaskId: (row.blocked_by_task_id as string) ?? undefined,
    completionOutput: (row.completion_output as string) ?? undefined,
    reviewOnComplete: row.review_on_complete === 1 ? true : undefined,
    enabled: row.enabled === 1,
    lastSessionId: (row.last_session_id as string) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export function listTasks(filter: ListTasksFilter = {}): Task[] {
  const db = getDb()
  const conditions: string[] = []
  const params: SqlValue[] = []

  if (filter.projectId) {
    conditions.push('project_id = ?')
    params.push(filter.projectId)
  }
  if (filter.sessionId) {
    conditions.push('session_id = ?')
    params.push(filter.sessionId)
  }
  if (filter.kind) {
    conditions.push('kind = ?')
    params.push(filter.kind)
  }
  if (filter.status) {
    conditions.push('status = ?')
    params.push(filter.status)
  }
  if (filter.assignee) {
    conditions.push('assignee = ?')
    params.push(filter.assignee)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = db.query(`SELECT * FROM tasks ${where} ORDER BY order_index ASC, created_at DESC`).all(...params) as Record<string, unknown>[]
  return rows.map(rowToTask)
}

export function getTask(id: string): Task | null {
  const db = getDb()
  const row = db.query('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | null
  return row ? rowToTask(row) : null
}

export function createTask(input: CreateTaskInput): Task {
  const db = getDb()
  const id = newId()
  const ts = now()

  let executorKind: string | null = null
  let executorConfig: string | null = null
  if (input.executor) {
    const { kind, ...rest } = input.executor
    executorKind = kind
    executorConfig = JSON.stringify(rest)
  }

  db.run(
    `INSERT INTO tasks (
      id, project_id, created_by, origin_session_id, session_id,
      title, description, assignee, kind, status,
      order_index, schedule_config,
      executor_kind, executor_config, executor_options,
      waiting_instructions, blocked_by_task_id,
      review_on_complete, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.projectId,
      input.createdBy ?? 'human',
      input.originSessionId ?? null,
      input.sessionId ?? null,
      input.title,
      input.description ?? null,
      input.assignee,
      input.kind,
      input.order ?? null,
      input.scheduleConfig ? JSON.stringify(input.scheduleConfig) : null,
      executorKind,
      executorConfig,
      input.executorOptions ? JSON.stringify(input.executorOptions) : null,
      input.waitingInstructions ?? null,
      input.blockedByTaskId ?? null,
      input.reviewOnComplete ? 1 : 0,
      input.enabled !== false ? 1 : 0,
      ts,
      ts,
    ],
  )
  return getTask(id)!
}

export function updateTask(id: string, input: UpdateTaskInput): Task | null {
  const db = getDb()
  const task = getTask(id)
  if (!task) return null

  const ts = now()
  const fields: string[] = ['updated_at = ?']
  const params: SqlValue[] = [ts]

  if (input.title !== undefined) { fields.push('title = ?'); params.push(input.title) }
  if ('description' in input) { fields.push('description = ?'); params.push(input.description ?? null) }
  if (input.status !== undefined) { fields.push('status = ?'); params.push(input.status) }
  if (input.enabled !== undefined) { fields.push('enabled = ?'); params.push(input.enabled ? 1 : 0) }
  if ('completionOutput' in input) { fields.push('completion_output = ?'); params.push(input.completionOutput ?? null) }
  if ('blockedByTaskId' in input) { fields.push('blocked_by_task_id = ?'); params.push(input.blockedByTaskId ?? null) }
  if ('lastSessionId' in input) { fields.push('last_session_id = ?'); params.push(input.lastSessionId ?? null) }
  if ('sessionId' in input) { fields.push('session_id = ?'); params.push(input.sessionId ?? null) }
  if (input.reviewOnComplete !== undefined) { fields.push('review_on_complete = ?'); params.push(input.reviewOnComplete ? 1 : 0) }

  if ('scheduleConfig' in input) {
    fields.push('schedule_config = ?')
    params.push(input.scheduleConfig ? JSON.stringify(input.scheduleConfig) : null)
  }
  if ('executor' in input) {
    if (input.executor) {
      const { kind, ...rest } = input.executor
      fields.push('executor_kind = ?', 'executor_config = ?')
      params.push(kind, JSON.stringify(rest))
    } else {
      fields.push('executor_kind = ?', 'executor_config = ?')
      params.push(null, null)
    }
  }
  if ('executorOptions' in input) {
    fields.push('executor_options = ?')
    params.push(input.executorOptions ? JSON.stringify(input.executorOptions) : null)
  }

  params.push(id)
  db.run(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, params)
  return getTask(id)!
}

export function deleteTask(id: string): boolean {
  const db = getDb()
  const tx = db.transaction(() => {
    db.run(`UPDATE tasks SET blocked_by_task_id = NULL WHERE blocked_by_task_id = ?`, [id])
    return db.run('DELETE FROM tasks WHERE id = ?', [id])
  })
  return tx().changes > 0
}

export function getBlockedByTask(blockedByTaskId: string): Task[] {
  const db = getDb()
  const rows = db.query(
    "SELECT * FROM tasks WHERE blocked_by_task_id = ? AND status = 'blocked'",
  ).all(blockedByTaskId) as Record<string, unknown>[]
  return rows.map(rowToTask)
}

export function reconcileRunningTasks(): Task[] {
  const db = getDb()
  const ts = now()
  const rows = db.query("SELECT * FROM tasks WHERE status = 'running'").all() as Record<string, unknown>[]
  if (rows.length === 0) return []
  db.run(`UPDATE tasks SET status = 'pending', updated_at = ? WHERE status = 'running'`, [ts])
  return rows.map(rowToTask)
}
