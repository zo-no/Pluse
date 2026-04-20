import { randomBytes } from 'node:crypto'
import type { CreateTodoInput, Todo, TodoPriority, TodoRepeat, TodoStatus, UpdateTodoInput } from '@pluse/types'
import { getDb } from '../db'

function genId(): string {
  return 'todo_' + randomBytes(8).toString('hex')
}

function now(): string {
  return new Date().toISOString()
}

type TodoRow = {
  id: string
  project_id: string
  created_by: Todo['createdBy']
  origin_quest_id: string | null
  title: string
  description: string | null
  waiting_instructions: string | null
  due_at: string | null
  repeat: TodoRepeat
  priority: TodoPriority
  tags: string
  status: TodoStatus
  deleted: number
  deleted_at: string | null
  created_at: string
  updated_at: string
}

function rowToTodo(row: TodoRow): Todo {
  let tags: string[] = []
  try { tags = JSON.parse(row.tags ?? '[]') } catch {}
  return {
    id: row.id,
    projectId: row.project_id,
    createdBy: row.created_by,
    originQuestId: row.origin_quest_id ?? undefined,
    title: row.title,
    description: row.description ?? undefined,
    waitingInstructions: row.waiting_instructions ?? undefined,
    dueAt: row.due_at ?? undefined,
    repeat: row.repeat ?? 'none',
    priority: (row.priority as TodoPriority) ?? 'normal',
    tags,
    status: row.status,
    deleted: row.deleted === 1 ? true : undefined,
    deletedAt: row.deleted_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function deduplicateTags(tags: string[]): string[] {
  const seen = new Set<string>()
  return tags.filter((tag) => {
    const lower = tag.toLowerCase()
    if (seen.has(lower)) return false
    seen.add(lower)
    return true
  })
}

export function listTodos(filter: {
  projectId?: string
  status?: TodoStatus
  deleted?: boolean
  tags?: string[]
  priority?: TodoPriority
} = {}): Todo[] {
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
  if (filter.priority) {
    conditions.push('priority = ?')
    params.push(filter.priority)
  }
  if (filter.tags && filter.tags.length > 0) {
    const placeholders = filter.tags.map(() => 'LOWER(?)').join(', ')
    conditions.push(
      `EXISTS (SELECT 1 FROM json_each(todos.tags) WHERE LOWER(json_each.value) IN (${placeholders}))`
    )
    params.push(...filter.tags)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = db.query<TodoRow, Array<string | number>>(
    `SELECT * FROM todos ${where}
      ORDER BY
        status = 'pending' DESC,
        CASE priority
          WHEN 'urgent' THEN 0
          WHEN 'high'   THEN 1
          WHEN 'normal' THEN 2
          WHEN 'low'    THEN 3
          ELSE 2
        END ASC,
        CASE WHEN status = 'pending' AND due_at IS NOT NULL THEN 0 ELSE 1 END ASC,
        due_at ASC,
        updated_at DESC`
  ).all(...params)
  return rows.map(rowToTodo)
}

export function getTodo(id: string): Todo | null {
  const db = getDb()
  const row = db.query<TodoRow, [string]>('SELECT * FROM todos WHERE id = ?').get(id)
  return row ? rowToTodo(row) : null
}

export function listProjectTags(projectId: string): string[] {
  const db = getDb()
  const rows = db.query<{ tag: string }, [string]>(
    `SELECT DISTINCT json_each.value AS tag
     FROM todos, json_each(todos.tags)
     WHERE todos.project_id = ? AND todos.deleted = 0
     ORDER BY tag ASC`
  ).all(projectId)
  return rows.map((r) => r.tag)
}

export function createTodo(input: CreateTodoInput): Todo {
  const db = getDb()
  const id = genId()
  const ts = now()
  const tags = JSON.stringify(deduplicateTags(input.tags ?? []))
  db.run(
    `INSERT INTO todos (
      id, project_id, created_by, origin_quest_id,
      title, description, waiting_instructions, due_at, repeat,
      priority, tags,
      status, deleted, deleted_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.projectId,
      input.createdBy ?? 'human',
      input.originQuestId ?? null,
      input.title,
      input.description ?? null,
      input.waitingInstructions ?? null,
      input.dueAt ?? null,
      input.repeat ?? 'none',
      input.priority ?? 'normal',
      tags,
      input.status ?? 'pending',
      input.deleted ? 1 : 0,
      input.deleted ? ts : null,
      ts,
      ts,
    ],
  )
  return getTodo(id)!
}

export function updateTodo(id: string, input: UpdateTodoInput): Todo {
  const db = getDb()
  const existing = getTodo(id)
  if (!existing) throw new Error(`Todo not found: ${id}`)

  const sets: string[] = ['updated_at = ?']
  const ts = now()
  const params: Array<string | number | null> = [ts]

  if ('originQuestId' in input) { sets.push('origin_quest_id = ?'); params.push(input.originQuestId ?? null) }
  if ('title' in input && input.title !== undefined) { sets.push('title = ?'); params.push(input.title) }
  if ('description' in input) { sets.push('description = ?'); params.push(input.description ?? null) }
  if ('waitingInstructions' in input) { sets.push('waiting_instructions = ?'); params.push(input.waitingInstructions ?? null) }
  if ('dueAt' in input) { sets.push('due_at = ?'); params.push(input.dueAt ?? null) }
  if ('repeat' in input && input.repeat !== undefined) { sets.push('repeat = ?'); params.push(input.repeat) }
  if ('priority' in input && input.priority !== undefined) { sets.push('priority = ?'); params.push(input.priority) }
  if ('tags' in input) {
    const newTags = input.tags == null ? [] : deduplicateTags(input.tags)
    sets.push('tags = ?')
    params.push(JSON.stringify(newTags))
  }
  if ('status' in input && input.status !== undefined) { sets.push('status = ?'); params.push(input.status) }
  if ('deleted' in input && input.deleted !== undefined) {
    sets.push('deleted = ?')
    params.push(input.deleted ? 1 : 0)
    sets.push('deleted_at = ?')
    params.push(input.deleted ? ts : null)
  }

  params.push(id)
  db.run(`UPDATE todos SET ${sets.join(', ')} WHERE id = ?`, params)
  return getTodo(id)!
}

export function deleteTodo(id: string): boolean {
  const existing = getTodo(id)
  if (!existing) return false
  updateTodo(id, { deleted: true })
  return true
}
