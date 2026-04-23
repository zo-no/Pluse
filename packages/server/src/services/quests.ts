import type { CreateQuestInput, MoveQuestInput, Quest, QuestOp, Run, UpdateQuestInput } from '@pluse/types'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getDb } from '../db'
import { listEvents } from '../models/history'
import { createProjectActivity } from '../models/project-activity'
import { createQuestOp, getQuestOps } from '../models/quest-op'
import { createQuest, getQuest, listQuests, updateQuest } from '../models/quest'
import { getProject } from '../models/project'
import { getLatestRunForQuest, getRun, getRunsByQuest } from '../models/run'
import { getSessionCategory } from '../models/session-category'
import { emit } from './events'
import { refreshQuestSchedule } from './scheduler'
import { deleteSessionCategoryIfEmptyWithEffects } from './session-categories'
import { getAssetsDir, getHistoryRoot, getPluseRoot } from '../support/paths'

function emitQuestUpdated(quest: Quest): void {
  emit({ type: 'quest_updated', data: { questId: quest.id, projectId: quest.projectId } })
}

function emitProjectUpdated(projectId: string): void {
  emit({ type: 'project_updated', data: { projectId } })
}

function isInFlightRun(run: Run | null | undefined): boolean {
  return run?.state === 'accepted' || run?.state === 'running'
}

function questHasActiveRun(quest: Quest): boolean {
  if (quest.activeRunId && isInFlightRun(getRun(quest.activeRunId))) {
    return true
  }
  return isInFlightRun(getLatestRunForQuest(quest.id))
}

function assertProjectContextAvailable(quest: Quest, targetProjectId: string): void {
  const targetQuests = listQuests({ projectId: targetProjectId })
    .filter((item) => item.id !== quest.id)

  if (quest.codexThreadId && targetQuests.some((item) => item.codexThreadId === quest.codexThreadId)) {
    throw new Error(`Target project already has a quest using codexThreadId ${quest.codexThreadId}`)
  }

  if (quest.claudeSessionId && targetQuests.some((item) => item.claudeSessionId === quest.claudeSessionId)) {
    throw new Error(`Target project already has a quest using claudeSessionId ${quest.claudeSessionId}`)
  }
}

function getSessionArchiveRoot(archivedAt: string): string {
  const date = archivedAt.slice(0, 10)
  return join(getPluseRoot(), 'archive', 'sessions', date)
}

function archiveSessionStorage(questId: string, archivedAt: string): void {
  const sourceHistory = join(getHistoryRoot(), questId)
  const sourceAssets = getAssetsDir(questId)
  if (!existsSync(sourceHistory) && !existsSync(sourceAssets)) return

  const destinationRoot = join(getSessionArchiveRoot(archivedAt), questId)
  mkdirSync(destinationRoot, { recursive: true })
  if (existsSync(sourceHistory)) {
    cpSync(sourceHistory, join(destinationRoot, 'history'), { recursive: true })
  }
  if (existsSync(sourceAssets)) {
    cpSync(sourceAssets, join(destinationRoot, 'assets'), { recursive: true })
  }
}

function hasStableSessionName(name?: string | null): boolean {
  const normalized = name?.trim()
  return Boolean(normalized && normalized !== '新会话' && normalized !== 'New Session' && normalized !== 'Untitled Session')
}

function compactSessionName(source: string): string {
  const compact = source
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return compact.length > 48 ? `${compact.slice(0, 45).trim()}...` : compact
}

function deriveSessionListName(quest: Quest): string | undefined {
  if (quest.kind !== 'session' || hasStableSessionName(quest.name)) return quest.name
  const firstUserMessage = listEvents(quest.id)
    .find((event) => event.type === 'message' && event.role === 'user' && event.content?.trim())
    ?.content
    ?.trim()
  return firstUserMessage ? compactSessionName(firstUserMessage) : quest.name
}

function questActivityTitle(quest: Quest): string {
  return quest.title?.trim()
    || quest.name?.trim()
    || (quest.kind === 'task' ? '未命名自动化' : '未命名会话')
}

function assertSessionCategoryBelongsToProject(projectId: string, sessionCategoryId: string | null | undefined): void {
  if (!sessionCategoryId) return
  const category = getSessionCategory(sessionCategoryId)
  if (!category) throw new Error(`Session category not found: ${sessionCategoryId}`)
  if (category.projectId !== projectId) {
    throw new Error(`Session category ${sessionCategoryId} does not belong to project ${projectId}`)
  }
}

export function listQuestViews(filter: Parameters<typeof listQuests>[0] = {}): Quest[] {
  return listQuests(filter).map((quest) => (
    quest.kind === 'session'
      ? {
          ...quest,
          name: deriveSessionListName(quest),
        }
      : quest
  ))
}

export function createQuestWithEffects(input: CreateQuestInput): Quest {
  const created = createQuest(input)
  createQuestOp({
    questId: created.id,
    op: 'created',
    actor: input.createdBy === 'ai' ? 'ai' : input.createdBy === 'system' ? 'system' : 'human',
    toKind: created.kind,
    toStatus: created.status,
  })
  createProjectActivity({
    projectId: created.projectId,
    subjectType: created.kind,
    subjectId: created.id,
    questId: created.id,
    title: questActivityTitle(created),
    op: 'created',
    actor: input.createdBy === 'ai' ? 'ai' : input.createdBy === 'system' ? 'system' : 'human',
    toKind: created.kind,
    toStatus: created.status,
  })
  refreshQuestSchedule(created)
  const quest = getQuest(created.id) ?? created
  emitQuestUpdated(quest)
  return quest
}

export function updateQuestWithEffects(id: string, input: UpdateQuestInput): Quest {
  const before = getQuest(id)
  if (!before) throw new Error(`Quest not found: ${id}`)
  if ('sessionCategoryId' in input) {
    assertSessionCategoryBelongsToProject(before.projectId, input.sessionCategoryId)
  }
  const updated = updateQuest(id, input)
  const detachedSessionCategoryId = (
    before.sessionCategoryId
    && before.sessionCategoryId !== updated.sessionCategoryId
      ? before.sessionCategoryId
      : null
  )
  if (
    before.kind === 'session'
    && !before.deleted
    && input.deleted === true
    && updated.deleted === true
    && updated.deletedAt
  ) {
    archiveSessionStorage(updated.id, updated.deletedAt)
  }

  if (before.kind !== updated.kind) {
    createQuestOp({
      questId: updated.id,
      op: 'kind_changed',
      actor: 'human',
      fromKind: before.kind,
      toKind: updated.kind,
      fromStatus: before.status,
      toStatus: updated.status,
    })
    createProjectActivity({
      projectId: updated.projectId,
      subjectType: updated.kind,
      subjectId: updated.id,
      questId: updated.id,
      title: questActivityTitle(updated),
      op: 'kind_changed',
      actor: 'human',
      fromKind: before.kind,
      toKind: updated.kind,
      fromStatus: before.status,
      toStatus: updated.status,
    })
  } else if (before.status !== updated.status && updated.kind === 'task') {
    createQuestOp({
      questId: updated.id,
      op: 'status_changed',
      actor: 'human',
      fromStatus: before.status,
      toStatus: updated.status,
    })
    createProjectActivity({
      projectId: updated.projectId,
      subjectType: updated.kind,
      subjectId: updated.id,
      questId: updated.id,
      title: questActivityTitle(updated),
      op: 'status_changed',
      actor: 'human',
      fromStatus: before.status,
      toStatus: updated.status,
    })
  }

  if (!before.deleted && updated.deleted) {
    createQuestOp({
      questId: updated.id,
      op: 'deleted',
      actor: 'human',
      fromKind: before.kind,
      toKind: updated.kind,
      fromStatus: before.status,
      toStatus: updated.status,
    })
    createProjectActivity({
      projectId: updated.projectId,
      subjectType: updated.kind,
      subjectId: updated.id,
      questId: updated.id,
      title: questActivityTitle(updated),
      op: 'deleted',
      actor: 'human',
      fromKind: before.kind,
      toKind: updated.kind,
      fromStatus: before.status,
      toStatus: updated.status,
    })
  }

  refreshQuestSchedule(updated)
  if (detachedSessionCategoryId) {
    deleteSessionCategoryIfEmptyWithEffects(detachedSessionCategoryId)
  }
  const quest = getQuest(updated.id) ?? updated
  emitQuestUpdated(quest)
  return quest
}

export function moveQuestWithEffects(id: string, input: MoveQuestInput): Quest {
  const before = getQuest(id)
  if (!before) throw new Error(`Quest not found: ${id}`)
  if (questHasActiveRun(before)) throw new Error('Cannot move quest while a run is active')
  if (before.projectId === input.targetProjectId) {
    throw new Error(`Quest already belongs to project: ${before.projectId}`)
  }

  const targetProject = getProject(input.targetProjectId)
  if (!targetProject || targetProject.visibility === 'system') {
    throw new Error(`Target project not found: ${input.targetProjectId}`)
  }
  if (targetProject.archived) {
    throw new Error(`Target project is archived: ${input.targetProjectId}`)
  }

  assertProjectContextAvailable(before, input.targetProjectId)

  const db = getDb()
  const movedAt = new Date().toISOString()
  const tx = db.transaction(() => {
    db.run(
      'UPDATE quests SET project_id = ?, session_category_id = NULL, updated_at = ? WHERE id = ?',
      [input.targetProjectId, movedAt, id],
    )
    db.run(
      'UPDATE runs SET project_id = ? WHERE quest_id = ?',
      [input.targetProjectId, id],
    )
  })

  try {
    tx()
  } catch (error) {
    const message = String(error)
    if (message.includes('UNIQUE constraint failed')) {
      throw new Error(`Target project cannot accept quest ${id} because provider context already exists there`)
    }
    throw error
  }

  const moved = getQuest(id)!
  createQuestOp({
    questId: moved.id,
    op: 'project_changed',
    actor: 'human',
    note: `Moved from ${before.projectId} to ${moved.projectId}`,
  })
  createProjectActivity({
    projectId: before.projectId,
    subjectType: before.kind,
    subjectId: moved.id,
    questId: moved.id,
    title: questActivityTitle(before),
    op: 'project_changed_out',
    actor: 'human',
    note: `Moved to ${moved.projectId}`,
  })
  createProjectActivity({
    projectId: moved.projectId,
    subjectType: moved.kind,
    subjectId: moved.id,
    questId: moved.id,
    title: questActivityTitle(moved),
    op: 'project_changed_in',
    actor: 'human',
    note: `Moved from ${before.projectId}`,
  })
  emit({ type: 'quest_updated', data: { questId: moved.id, projectId: before.projectId } })
  emitQuestUpdated(moved)
  if (before.sessionCategoryId) {
    deleteSessionCategoryIfEmptyWithEffects(before.sessionCategoryId)
  }
  emitProjectUpdated(before.projectId)
  emitProjectUpdated(moved.projectId)
  return moved
}

export function deleteQuestWithEffects(id: string): void {
  const quest = getQuest(id)
  if (!quest) throw new Error(`Quest not found: ${id}`)
  updateQuestWithEffects(id, { deleted: true })
  emit({ type: 'quest_deleted', data: { questId: id, projectId: quest.projectId } })
}

export function getQuestRunsView(id: string, limit = 50): Run[] {
  return getRunsByQuest(id).slice(0, limit)
}

export function getQuestOpsView(id: string, limit = 50): QuestOp[] {
  return getQuestOps(id, limit)
}
