import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import type {
  ApiResult,
  CreateQuestInput,
  MoveQuestInput,
  PagedResult,
  Quest,
  QuestEvent,
  QuestOp,
  Run,
  SendMessageInput,
  UpdateQuestInput,
} from '@pluse/types'
import { listEvents } from '../../models/history'
import { getQuest } from '../../models/quest'
import { cancelQueuedRequest, clearQueuedRequests, startQuestRun, submitQuestMessage } from '../../runtime/session-runner'
import {
  createQuestWithEffects,
  deleteQuestWithEffects,
  getQuestOpsView,
  getQuestRunsView,
  listQuestViews,
  moveQuestWithEffects,
  updateQuestWithEffects,
} from '../../services/quests'

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

function errBody(error: string): ApiResult<never> {
  return { ok: false, error }
}

function sc(n: number): ContentfulStatusCode {
  return n as ContentfulStatusCode
}

const QuestSchema = z.object({
  projectId: z.string().min(1),
  kind: z.enum(['session', 'task']),
  createdBy: z.enum(['human', 'ai', 'system']).optional(),
  tool: z.string().optional(),
  model: z.string().nullable().optional(),
  effort: z.string().nullable().optional(),
  thinking: z.boolean().optional(),
  name: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  pinned: z.boolean().optional(),
  deleted: z.boolean().optional(),
  autoRenamePending: z.boolean().optional(),
  scheduleKind: z.enum(['once', 'scheduled', 'recurring']).optional(),
  scheduleConfig: z.any().nullable().optional(),
  executorKind: z.enum(['ai_prompt', 'script']).optional(),
  executorConfig: z.any().nullable().optional(),
  executorOptions: z.any().nullable().optional(),
  reviewOnComplete: z.boolean().optional(),
  order: z.number().nullable().optional(),
  status: z.enum(['idle', 'running', 'pending', 'done', 'failed', 'cancelled']).optional(),
  codexThreadId: z.string().nullable().optional(),
  claudeSessionId: z.string().nullable().optional(),
})

const QuestPatchSchema = z.object({
  kind: z.enum(['session', 'task']).optional(),
  name: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  sessionCategoryId: z.string().nullable().optional(),
  status: z.enum(['idle', 'running', 'pending', 'done', 'failed', 'cancelled']).optional(),
  enabled: z.boolean().optional(),
  pinned: z.boolean().optional(),
  deleted: z.boolean().optional(),
  autoRenamePending: z.boolean().optional(),
  tool: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  effort: z.string().nullable().optional(),
  thinking: z.boolean().optional(),
  activeRunId: z.string().nullable().optional(),
  scheduleKind: z.enum(['once', 'scheduled', 'recurring']).nullable().optional(),
  scheduleConfig: z.any().nullable().optional(),
  executorKind: z.enum(['ai_prompt', 'script']).nullable().optional(),
  executorConfig: z.any().nullable().optional(),
  executorOptions: z.any().nullable().optional(),
  completionOutput: z.string().nullable().optional(),
  reviewOnComplete: z.boolean().optional(),
  order: z.number().nullable().optional(),
  codexThreadId: z.string().nullable().optional(),
  claudeSessionId: z.string().nullable().optional(),
  unread: z.boolean().optional(),
})

const SendMessageSchema = z.object({
  text: z.string().min(1),
  requestId: z.string().optional(),
  tool: z.string().optional(),
  model: z.string().nullable().optional(),
  effort: z.string().nullable().optional(),
  thinking: z.boolean().optional(),
  attachments: z.array(z.object({
    assetId: z.string(),
    filename: z.string(),
    savedPath: z.string(),
    mimeType: z.string(),
  })).optional(),
})

const RunSchema = z.object({
  requestId: z.string().optional(),
  trigger: z.enum(['manual', 'automation']).optional(),
  triggeredBy: z.enum(['human', 'scheduler', 'api', 'cli']).optional(),
})

const MoveQuestSchema = z.object({
  targetProjectId: z.string().min(1),
})

export const questsRouter = new Hono()

questsRouter.get('/quests', (c) => {
  const search = c.req.query('search')?.trim().toLowerCase()
  const rawLimit = Number.parseInt(c.req.query('limit') || '', 10)
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : undefined
  const items = listQuestViews({
    projectId: c.req.query('projectId') || undefined,
    kind: (c.req.query('kind') as Quest['kind'] | undefined) || undefined,
    deleted: c.req.query('deleted') === 'true',
    status: (c.req.query('status') as Quest['status'] | undefined) || undefined,
    limit: search ? undefined : limit,
  })
  const filtered = search
    ? items.filter((quest) => `${quest.name ?? ''} ${quest.title ?? ''} ${quest.description ?? ''}`.toLowerCase().includes(search))
    : items
  return c.json(ok<Quest[]>(search && limit ? filtered.slice(0, limit) : filtered))
})

questsRouter.get('/quests/:id', (c) => {
  const quest = getQuest(c.req.param('id'))
  if (!quest) return c.json(errBody('Quest not found'), sc(404))
  return c.json(ok(quest))
})

questsRouter.post('/quests', async (c) => {
  const body = await c.req.json().catch(() => undefined)
  const parsed = QuestSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))
  try {
    return c.json(ok(createQuestWithEffects(parsed.data as CreateQuestInput)), sc(201))
  } catch (error) {
    return c.json(errBody(String(error)), sc(400))
  }
})

questsRouter.patch('/quests/:id', async (c) => {
  const body = await c.req.json().catch(() => undefined)
  const parsed = QuestPatchSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))
  try {
    return c.json(ok(updateQuestWithEffects(c.req.param('id'), parsed.data as UpdateQuestInput)))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})

questsRouter.delete('/quests/:id', (c) => {
  try {
    deleteQuestWithEffects(c.req.param('id'))
    return c.json(ok({ deleted: true }))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})

questsRouter.post('/quests/:id/move', async (c) => {
  const body = await c.req.json().catch(() => undefined)
  const parsed = MoveQuestSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))
  try {
    return c.json(ok(moveQuestWithEffects(c.req.param('id'), parsed.data as MoveQuestInput)))
  } catch (error) {
    const message = String(error)
    if (message.includes('Target project not found')) return c.json(errBody(message), sc(404))
    if (
      message.includes('active run')
      || message.includes('already belongs to project')
      || message.includes('already has a quest using')
      || message.includes('cannot accept quest')
    ) {
      return c.json(errBody(message), sc(409))
    }
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})

questsRouter.get('/quests/:id/events', (c) => {
  const id = c.req.param('id')
  const limit = Math.min(parseInt(c.req.query('limit') || '2000', 10) || 2000, 2000)
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0)
  const items = listEvents(id, { limit, offset })
  const payload: PagedResult<QuestEvent> = {
    items,
    total: items.length,
    offset,
    limit,
  }
  return c.json(ok(payload))
})

questsRouter.get('/quests/:id/ops', (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 500)
  return c.json(ok<QuestOp[]>(getQuestOpsView(c.req.param('id'), limit)))
})

questsRouter.post('/quests/:id/messages', async (c) => {
  const body = await c.req.json().catch(() => undefined)
  const parsed = SendMessageSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))
  try {
    return c.json(ok(submitQuestMessage({
      questId: c.req.param('id'),
      ...(parsed.data as SendMessageInput),
    })))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})

questsRouter.post('/quests/:id/run', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const parsed = RunSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))
  try {
    const result = await startQuestRun({
      questId: c.req.param('id'),
      requestId: parsed.data.requestId,
      trigger: parsed.data.trigger ?? 'manual',
      triggeredBy: parsed.data.triggeredBy ?? 'api',
    })
    return c.json(ok(result))
  } catch (error) {
    const message = String(error)
    if (message.includes('QUEST_RUN_CONFLICT')) return c.json(errBody('Quest already has an active run'), sc(409))
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})

questsRouter.get('/quests/:id/runs', (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 500)
  return c.json(ok<Run[]>(getQuestRunsView(c.req.param('id'), limit)))
})

questsRouter.delete('/quests/:id/queue/:requestId', (c) => {
  try {
    return c.json(ok(cancelQueuedRequest(c.req.param('id'), c.req.param('requestId'))))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})

questsRouter.delete('/quests/:id/queue', (c) => {
  try {
    return c.json(ok(clearQueuedRequests(c.req.param('id'))))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})
