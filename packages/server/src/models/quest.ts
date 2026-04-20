import { randomBytes } from 'node:crypto'
import type {
  AiPromptConfig,
  CreateQuestInput,
  ExecutorOptions,
  ListQuestsFilter,
  Quest,
  QuestKind,
  QuestStatus,
  QueuedMessage,
  ScheduleConfig,
  ScriptConfig,
  UpdateQuestInput,
} from '@pluse/types'
import { getDb } from '../db'

function genId(): string {
  return 'qst_' + randomBytes(8).toString('hex')
}

function now(): string {
  return new Date().toISOString()
}

type QuestRow = {
  id: string
  project_id: string
  kind: QuestKind
  created_by: Quest['createdBy']
  codex_thread_id: string | null
  claude_session_id: string | null
  tool: string | null
  model: string | null
  effort: string | null
  thinking: number
  active_run_id: string | null
  name: string | null
  auto_rename_pending: number
  pinned: number
  follow_up_queue: string
  title: string | null
  description: string | null
  status: QuestStatus
  enabled: number
  schedule_kind: Quest['scheduleKind'] | null
  schedule_config: string | null
  executor_kind: Quest['executorKind'] | null
  executor_config: string | null
  executor_options: string | null
  completion_output: string | null
  review_on_complete: number
  order_index: number | null
  unread: number
  deleted: number
  deleted_at: string | null
  created_at: string
  updated_at: string
}

function normalizeQueuedMessage(entry: QueuedMessage): QueuedMessage {
  return {
    ...entry,
    displayText: entry.displayText || entry.text,
    promptText: entry.promptText || entry.text,
    queuedAt: entry.queuedAt || now(),
  }
}

function parseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}

function rowToQuest(row: QuestRow): Quest {
  const followUpQueue = (parseJson<QueuedMessage[]>(row.follow_up_queue) ?? []).map(normalizeQueuedMessage)
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    createdBy: row.created_by,
    codexThreadId: row.codex_thread_id ?? undefined,
    claudeSessionId: row.claude_session_id ?? undefined,
    tool: row.tool ?? undefined,
    model: row.model ?? undefined,
    effort: row.effort ?? undefined,
    thinking: row.thinking === 1,
    activeRunId: row.active_run_id ?? undefined,
    name: row.name ?? undefined,
    autoRenamePending: row.auto_rename_pending === 1 ? true : undefined,
    pinned: row.pinned === 1 ? true : undefined,
    followUpQueue,
    title: row.title ?? undefined,
    description: row.description ?? undefined,
    status: row.status,
    enabled: row.enabled === 1,
    scheduleKind: row.schedule_kind ?? undefined,
    scheduleConfig: parseJson<ScheduleConfig>(row.schedule_config),
    executorKind: row.executor_kind ?? undefined,
    executorConfig: parseJson<AiPromptConfig | ScriptConfig>(row.executor_config),
    executorOptions: parseJson<ExecutorOptions>(row.executor_options),
    completionOutput: row.completion_output ?? undefined,
    reviewOnComplete: row.review_on_complete === 1,
    order: row.order_index ?? undefined,
    unread: row.unread === 1 ? true : undefined,
    deleted: row.deleted === 1 ? true : undefined,
    deletedAt: row.deleted_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function defaultName(input: CreateQuestInput): string {
  return input.name?.trim() || input.title?.trim() || (input.kind === 'session' ? '新会话' : '新任务')
}

function defaultTitle(input: CreateQuestInput): string {
  return input.title?.trim() || input.name?.trim() || '新任务'
}

function defaultStatus(kind: QuestKind): QuestStatus {
  return kind === 'session' ? 'idle' : 'pending'
}

export function listQuests(filter: ListQuestsFilter = {}): Quest[] {
  const db = getDb()
  const conditions: string[] = []
  const params: Array<string | number> = []

  if (filter.projectId) {
    conditions.push('project_id = ?')
    params.push(filter.projectId)
  }
  if (filter.kind) {
    conditions.push('kind = ?')
    params.push(filter.kind)
  }
  if (filter.deleted !== undefined) {
    conditions.push('deleted = ?')
    params.push(filter.deleted ? 1 : 0)
  }
  if (filter.status) {
    conditions.push('status = ?')
    params.push(filter.status)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = db.query<QuestRow, Array<string | number>>(
    `SELECT * FROM quests ${where} ORDER BY updated_at DESC`
  ).all(...params)

  const quests = rows.map(rowToQuest)
  return quests.sort((a, b) => {
    if (a.kind === 'session' && b.kind === 'session') {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    }
    if (a.kind === 'task' && b.kind === 'task') {
      const rank = (value?: Quest['scheduleKind']) => value === 'recurring' ? 0 : value === 'scheduled' ? 1 : 2
      const rankDiff = rank(a.scheduleKind) - rank(b.scheduleKind)
      if (rankDiff !== 0) return rankDiff
      const orderA = a.order ?? Number.MAX_SAFE_INTEGER
      const orderB = b.order ?? Number.MAX_SAFE_INTEGER
      if (orderA !== orderB) return orderA - orderB
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    }
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  })
}

export function getQuest(id: string): Quest | null {
  const db = getDb()
  const row = db.query<QuestRow, [string]>('SELECT * FROM quests WHERE id = ?').get(id)
  return row ? rowToQuest(row) : null
}

export function createQuest(input: CreateQuestInput): Quest {
  const db = getDb()
  const id = genId()
  const ts = now()
  const status = input.status ?? defaultStatus(input.kind)

  db.run(
    `INSERT INTO quests (
      id, project_id, kind, created_by, codex_thread_id, claude_session_id,
      tool, model, effort, thinking, active_run_id,
      name, auto_rename_pending, pinned, follow_up_queue,
      title, description, status, enabled, schedule_kind, schedule_config,
      executor_kind, executor_config, executor_options, completion_output,
      review_on_complete, order_index, deleted, deleted_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?)`,
    [
      id,
      input.projectId,
      input.kind,
      input.createdBy ?? 'human',
      input.codexThreadId ?? null,
      input.claudeSessionId ?? null,
      input.tool ?? 'codex',
      input.model ?? null,
      input.effort ?? null,
      input.thinking ? 1 : 0,
      input.kind === 'session' ? defaultName(input) : null,
      input.autoRenamePending === false ? 0 : 1,
      input.pinned ? 1 : 0,
      input.kind === 'task' ? defaultTitle(input) : null,
      input.description ?? null,
      status,
      input.enabled === false ? 0 : 1,
      input.scheduleKind ?? null,
      input.scheduleConfig ? JSON.stringify(input.scheduleConfig) : null,
      input.executorKind ?? null,
      input.executorConfig ? JSON.stringify(input.executorConfig) : null,
      input.executorOptions ? JSON.stringify(input.executorOptions) : null,
      input.reviewOnComplete ? 1 : 0,
      input.order ?? null,
      input.deleted ? 1 : 0,
      ts,
      ts,
    ],
  )

  return getQuest(id)!
}

export function updateQuest(id: string, input: UpdateQuestInput): Quest {
  const db = getDb()
  const existing = getQuest(id)
  if (!existing) throw new Error(`Quest not found: ${id}`)

  const nextKind = input.kind ?? existing.kind
  if (input.kind && input.kind !== existing.kind && existing.activeRunId) {
    throw new Error('Cannot change quest kind while a run is active')
  }

  const sets: string[] = ['updated_at = ?']
  const params: Array<string | number | null> = [now()]

  const setField = (column: string, value: string | number | null) => {
    sets.push(`${column} = ?`)
    params.push(value)
  }

  if (input.kind !== undefined) setField('kind', nextKind)
  if ('name' in input) setField('name', input.name ?? null)
  if ('title' in input) setField('title', input.title ?? null)
  if ('description' in input) setField('description', input.description ?? null)
  if (input.status !== undefined) setField('status', input.status)
  if (input.enabled !== undefined) setField('enabled', input.enabled ? 1 : 0)
  if (input.pinned !== undefined) setField('pinned', input.pinned ? 1 : 0)
  if (input.autoRenamePending !== undefined) setField('auto_rename_pending', input.autoRenamePending ? 1 : 0)
  if ('tool' in input) setField('tool', input.tool ?? null)
  if ('model' in input) setField('model', input.model ?? null)
  if ('effort' in input) setField('effort', input.effort ?? null)
  if (input.thinking !== undefined) setField('thinking', input.thinking ? 1 : 0)
  if ('activeRunId' in input) setField('active_run_id', input.activeRunId ?? null)
  if ('scheduleKind' in input) setField('schedule_kind', input.scheduleKind ?? null)
  if ('scheduleConfig' in input) setField('schedule_config', input.scheduleConfig ? JSON.stringify(input.scheduleConfig) : null)
  if ('executorKind' in input) setField('executor_kind', input.executorKind ?? null)
  if ('executorConfig' in input) setField('executor_config', input.executorConfig ? JSON.stringify(input.executorConfig) : null)
  if ('executorOptions' in input) setField('executor_options', input.executorOptions ? JSON.stringify(input.executorOptions) : null)
  if ('completionOutput' in input) setField('completion_output', input.completionOutput ?? null)
  if (input.reviewOnComplete !== undefined) setField('review_on_complete', input.reviewOnComplete ? 1 : 0)
  if ('order' in input) setField('order_index', input.order ?? null)
  if (input.unread !== undefined) setField('unread', input.unread ? 1 : 0)
  if ('codexThreadId' in input) setField('codex_thread_id', input.codexThreadId ?? null)
  if ('claudeSessionId' in input) setField('claude_session_id', input.claudeSessionId ?? null)

  if (
    nextKind === 'session'
    && 'name' in input
    && input.autoRenamePending === undefined
    && typeof input.name === 'string'
    && input.name.trim()
  ) {
    setField('auto_rename_pending', 0)
  }

  if (input.deleted !== undefined) {
    setField('deleted', input.deleted ? 1 : 0)
    setField('deleted_at', input.deleted ? now() : null)
    if (input.deleted) {
      setField('follow_up_queue', '[]')
    }
  }

  if (input.kind && input.kind !== existing.kind) {
    if (input.kind === 'task') {
      setField('status', 'pending')
      if (!('title' in input)) setField('title', existing.title ?? existing.name ?? '新任务')
    } else {
      setField('status', 'idle')
      if (!('name' in input)) setField('name', existing.name ?? existing.title ?? '新会话')
    }
  }

  params.push(id)
  db.run(`UPDATE quests SET ${sets.join(', ')} WHERE id = ?`, params)
  return getQuest(id)!
}

export function deleteQuest(id: string): boolean {
  const db = getDb()
  return db.run('DELETE FROM quests WHERE id = ?', [id]).changes > 0
}

export function enqueueFollowUp(id: string, message: QueuedMessage): Quest {
  const quest = getQuest(id)
  if (!quest) throw new Error(`Quest not found: ${id}`)
  const queue = [...quest.followUpQueue]
  if (!queue.some((item) => item.requestId === message.requestId)) {
    queue.push(normalizeQueuedMessage(message))
  }
  const db = getDb()
  db.run('UPDATE quests SET follow_up_queue = ?, updated_at = ? WHERE id = ?', [JSON.stringify(queue), now(), id])
  return getQuest(id)!
}

export function dequeueFollowUp(id: string): { quest: Quest; message: QueuedMessage | null } {
  const quest = getQuest(id)
  if (!quest) throw new Error(`Quest not found: ${id}`)
  if (quest.followUpQueue.length === 0) {
    return { quest, message: null }
  }
  const [message, ...rest] = quest.followUpQueue
  const db = getDb()
  db.run('UPDATE quests SET follow_up_queue = ?, updated_at = ? WHERE id = ?', [JSON.stringify(rest), now(), id])
  return { quest: getQuest(id)!, message: message ?? null }
}

export function removeFollowUp(id: string, requestId: string): Quest {
  const quest = getQuest(id)
  if (!quest) throw new Error(`Quest not found: ${id}`)
  const next = quest.followUpQueue.filter((item) => item.requestId !== requestId)
  const db = getDb()
  db.run('UPDATE quests SET follow_up_queue = ?, updated_at = ? WHERE id = ?', [JSON.stringify(next), now(), id])
  return getQuest(id)!
}

export function clearFollowUps(id: string): Quest {
  const db = getDb()
  db.run('UPDATE quests SET follow_up_queue = ?, updated_at = ? WHERE id = ?', ['[]', now(), id])
  return getQuest(id)!
}

export function listQuestsWithPendingQueue(): Quest[] {
  const db = getDb()
  const rows = db.query<QuestRow, []>(
    `SELECT * FROM quests WHERE follow_up_queue != '[]'`
  ).all()
  return rows.map(rowToQuest)
}
