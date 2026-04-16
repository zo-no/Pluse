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
    sessionId: (row.session_id as string) ?? undefined,
    title: row.title as string,
    description: (row.description as string) ?? undefined,
    assignee: row.assignee as TaskAssignee,
    kind: row.kind as TaskKind,
    status: row.status as TaskStatus,
    surface: row.surface as Task['surface'],
    visibleInChat: row.visible_in_chat === 1,
    origin: row.origin as Task['origin'],
    originRunId: (row.origin_run_id as string) ?? undefined,
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
    sourceTaskId: (row.source_task_id as string) ?? undefined,
    blockedByTaskId: (row.blocked_by_task_id as string) ?? undefined,
    completionOutput: (row.completion_output as string) ?? undefined,
    enabled: row.enabled === 1,
    createdBy: row.created_by as Task['createdBy'],
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
  if (filter.surface) {
    conditions.push('surface = ?')
    params.push(filter.surface)
  }
  if (filter.visibleInChat !== undefined) {
    conditions.push('visible_in_chat = ?')
    params.push(filter.visibleInChat ? 1 : 0)
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
      id, project_id, session_id, title, description, assignee, kind, status,
      surface, visible_in_chat, origin, origin_run_id, order_index, schedule_config,
      executor_kind, executor_config, executor_options,
      waiting_instructions, source_task_id, blocked_by_task_id,
      enabled, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.projectId,
      input.sessionId ?? null,
      input.title,
      input.description ?? null,
      input.assignee,
      input.kind,
      input.surface,
      input.visibleInChat ? 1 : 0,
      input.origin,
      input.originRunId ?? null,
      input.order ?? null,
      input.scheduleConfig ? JSON.stringify(input.scheduleConfig) : null,
      executorKind,
      executorConfig,
      input.executorOptions ? JSON.stringify(input.executorOptions) : null,
      input.waitingInstructions ?? null,
      input.sourceTaskId ?? null,
      input.blockedByTaskId ?? null,
      input.enabled !== false ? 1 : 0,
      input.createdBy ?? 'human',
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
  if (input.surface !== undefined) { fields.push('surface = ?'); params.push(input.surface) }
  if (input.visibleInChat !== undefined) { fields.push('visible_in_chat = ?'); params.push(input.visibleInChat ? 1 : 0) }
  if (input.origin !== undefined) { fields.push('origin = ?'); params.push(input.origin) }
  if ('originRunId' in input) { fields.push('origin_run_id = ?'); params.push(input.originRunId ?? null) }
  if ('sessionId' in input) { fields.push('session_id = ?'); params.push(input.sessionId ?? null) }
  if (input.enabled !== undefined) { fields.push('enabled = ?'); params.push(input.enabled ? 1 : 0) }
  if ('completionOutput' in input) { fields.push('completion_output = ?'); params.push(input.completionOutput ?? null) }
  if ('blockedByTaskId' in input) { fields.push('blocked_by_task_id = ?'); params.push(input.blockedByTaskId ?? null) }
  if ('lastSessionId' in input) { fields.push('last_session_id = ?'); params.push(input.lastSessionId ?? null) }

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
    db.run(`UPDATE tasks SET source_task_id = NULL WHERE source_task_id = ?`, [id])
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
