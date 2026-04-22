import { randomBytes } from 'node:crypto'
import type { CreateSessionCategoryInput, SessionCategory, UpdateSessionCategoryInput } from '@pluse/types'
import { getDb } from '../db'

function genId(): string {
  return 'sc_' + randomBytes(8).toString('hex')
}

function now(): string {
  return new Date().toISOString()
}

type SessionCategoryRow = {
  id: string
  project_id: string
  name: string
  description: string | null
  collapsed: number
  created_at: string
  updated_at: string
}

function rowToSessionCategory(row: SessionCategoryRow): SessionCategory {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description ?? undefined,
    collapsed: row.collapsed === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listSessionCategories(projectId: string): SessionCategory[] {
  const db = getDb()
  const rows = db.query<SessionCategoryRow, [string]>(
    'SELECT * FROM session_categories WHERE project_id = ? ORDER BY name COLLATE NOCASE ASC, created_at ASC'
  ).all(projectId)
  return rows.map(rowToSessionCategory)
}

export function getSessionCategory(id: string): SessionCategory | null {
  const db = getDb()
  const row = db.query<SessionCategoryRow, [string]>(
    'SELECT * FROM session_categories WHERE id = ?'
  ).get(id)
  return row ? rowToSessionCategory(row) : null
}

export function findSessionCategoryByName(projectId: string, name: string): SessionCategory | null {
  const db = getDb()
  const row = db.query<SessionCategoryRow, [string, string]>(
    'SELECT * FROM session_categories WHERE project_id = ? AND name = ? LIMIT 1'
  ).get(projectId, name)
  return row ? rowToSessionCategory(row) : null
}

export function createSessionCategory(input: CreateSessionCategoryInput): SessionCategory {
  const db = getDb()
  const id = genId()
  const ts = now()
  db.run(
    `INSERT INTO session_categories (
      id, project_id, name, description, collapsed, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.projectId,
      input.name.trim(),
      input.description?.trim() || null,
      input.collapsed ? 1 : 0,
      ts,
      ts,
    ],
  )
  return getSessionCategory(id)!
}

export function updateSessionCategory(id: string, input: UpdateSessionCategoryInput): SessionCategory {
  const db = getDb()
  const existing = getSessionCategory(id)
  if (!existing) throw new Error(`Session category not found: ${id}`)

  const sets: string[] = ['updated_at = ?']
  const params: Array<string | number | null> = [now()]

  if ('name' in input) {
    sets.push('name = ?')
    params.push(input.name?.trim() || null)
  }
  if ('description' in input) {
    sets.push('description = ?')
    params.push(input.description?.trim() || null)
  }
  if (input.collapsed !== undefined) {
    sets.push('collapsed = ?')
    params.push(input.collapsed ? 1 : 0)
  }

  params.push(id)
  db.run(`UPDATE session_categories SET ${sets.join(', ')} WHERE id = ?`, params)
  return getSessionCategory(id)!
}

export function deleteSessionCategory(id: string): void {
  const db = getDb()
  db.run('DELETE FROM session_categories WHERE id = ?', [id])
}
