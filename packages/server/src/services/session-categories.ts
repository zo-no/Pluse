import type { CreateSessionCategoryInput, SessionCategory, UpdateSessionCategoryInput } from '@pluse/types'
import { getDb } from '../db'
import {
  createSessionCategory,
  deleteSessionCategory,
  findSessionCategoryByName,
  getSessionCategory,
  listSessionCategories,
  updateSessionCategory,
} from '../models/session-category'
import { getProject } from '../models/project'
import { emit } from './events'

function emitProjectUpdated(projectId: string): void {
  emit({ type: 'project_updated', data: { projectId } })
}

function countQuestBindings(sessionCategoryId: string): number {
  const db = getDb()
  const row = db.query<{ total: number }, [string]>(
    'SELECT COUNT(1) as total FROM quests WHERE session_category_id = ?'
  ).get(sessionCategoryId)
  return row?.total ?? 0
}

function assertProjectExists(projectId: string): void {
  const project = getProject(projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)
}

export function listSessionCategoryViews(projectId: string): SessionCategory[] {
  return listSessionCategories(projectId)
}

export function createSessionCategoryWithEffects(input: CreateSessionCategoryInput): SessionCategory {
  assertProjectExists(input.projectId)
  const created = createSessionCategory(input)
  emitProjectUpdated(created.projectId)
  return created
}

export function updateSessionCategoryWithEffects(id: string, input: UpdateSessionCategoryInput): SessionCategory {
  const existing = getSessionCategory(id)
  if (!existing) throw new Error(`Session category not found: ${id}`)
  const updated = updateSessionCategory(id, input)
  emitProjectUpdated(updated.projectId)
  return updated
}

export function deleteSessionCategoryWithEffects(id: string): void {
  const existing = getSessionCategory(id)
  if (!existing) throw new Error(`Session category not found: ${id}`)

  const db = getDb()
  const ts = new Date().toISOString()
  const tx = db.transaction(() => {
    db.run(
      'UPDATE quests SET session_category_id = NULL, updated_at = ? WHERE session_category_id = ?',
      [ts, id],
    )
    deleteSessionCategory(id)
  })
  tx()
  emitProjectUpdated(existing.projectId)
}

export function deleteSessionCategoryIfEmptyWithEffects(id: string): boolean {
  const db = getDb()
  const tx = db.transaction(() => {
    const existing = getSessionCategory(id)
    if (!existing) return null
    if (countQuestBindings(id) > 0) return null
    deleteSessionCategory(id)
    return existing.projectId
  })
  const deletedProjectId = tx()
  if (!deletedProjectId) return false
  emitProjectUpdated(deletedProjectId)
  return true
}

export function createOrReuseSessionCategory(projectId: string, input: { name: string; description?: string }): SessionCategory {
  assertProjectExists(projectId)
  const normalizedName = input.name.trim()
  if (!normalizedName) throw new Error('Session category name is required')
  const existing = findSessionCategoryByName(projectId, normalizedName)
  if (existing) return existing
  const created = createSessionCategory({
    projectId,
    name: normalizedName,
    description: input.description?.trim() || undefined,
    collapsed: false,
  })
  emitProjectUpdated(projectId)
  return created
}
