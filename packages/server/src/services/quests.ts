import type { CreateQuestInput, Quest, QuestOp, Run, UpdateQuestInput } from '@pluse/types'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { getDb } from '../db'
import { listEvents } from '../models/history'
import { createQuestOp, getQuestOps } from '../models/quest-op'
import { createQuest, deleteQuest, getQuest, listQuests, updateQuest } from '../models/quest'
import { getRunsByQuest } from '../models/run'
import { listTodos, updateTodo } from '../models/todo'
import { emit } from './events'
import { refreshQuestSchedule, removeScheduledQuest } from './scheduler'
import { getAssetsDir, getHistoryRoot, getPluseRoot } from '../support/paths'

function emitQuestUpdated(quest: Quest): void {
  emit({ type: 'quest_updated', data: { questId: quest.id, projectId: quest.projectId } })
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
  const quest = createQuest(input)
  createQuestOp({
    questId: quest.id,
    op: 'created',
    actor: input.createdBy === 'ai' ? 'ai' : input.createdBy === 'system' ? 'system' : 'human',
    toKind: quest.kind,
    toStatus: quest.status,
  })
  refreshQuestSchedule(quest)
  emitQuestUpdated(quest)
  return quest
}

export function updateQuestWithEffects(id: string, input: UpdateQuestInput): Quest {
  const before = getQuest(id)
  if (!before) throw new Error(`Quest not found: ${id}`)
  const quest = updateQuest(id, input)
  if (
    before.kind === 'session'
    && !before.deleted
    && input.deleted === true
    && quest.deleted === true
    && quest.deletedAt
  ) {
    archiveSessionStorage(quest.id, quest.deletedAt)
  }

  if (before.kind !== quest.kind) {
    createQuestOp({
      questId: quest.id,
      op: 'kind_changed',
      actor: 'human',
      fromKind: before.kind,
      toKind: quest.kind,
      fromStatus: before.status,
      toStatus: quest.status,
    })
  } else if (before.status !== quest.status && quest.kind === 'task') {
    createQuestOp({
      questId: quest.id,
      op: 'status_changed',
      actor: 'human',
      fromStatus: before.status,
      toStatus: quest.status,
    })
  }

  refreshQuestSchedule(quest)
  emitQuestUpdated(quest)
  return quest
}

export function deleteQuestWithEffects(id: string): void {
  const quest = getQuest(id)
  if (!quest) throw new Error(`Quest not found: ${id}`)

  removeScheduledQuest(id)
  for (const todo of listTodos({ projectId: quest.projectId })) {
    if (todo.originQuestId === id) {
      updateTodo(todo.id, { originQuestId: null })
    }
  }
  const db = getDb()
  db.run(`DELETE FROM run_spool WHERE run_id IN (SELECT id FROM runs WHERE quest_id = ?)`, [id])
  db.run(`DELETE FROM runs WHERE quest_id = ?`, [id])
  db.run(`DELETE FROM assets WHERE quest_id = ?`, [id])
  db.run(`DELETE FROM quest_ops WHERE quest_id = ?`, [id])
  deleteQuest(id)

  rmSync(join(getHistoryRoot(), id), { recursive: true, force: true })
  rmSync(getAssetsDir(id), { recursive: true, force: true })
  emit({ type: 'quest_deleted', data: { questId: id, projectId: quest.projectId } })
}

export function getQuestRunsView(id: string, limit = 50): Run[] {
  return getRunsByQuest(id).slice(0, limit)
}

export function getQuestOpsView(id: string, limit = 50): QuestOp[] {
  return getQuestOps(id, limit)
}
