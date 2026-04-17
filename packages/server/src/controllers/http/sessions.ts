import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import type { ApiResult, CreateSessionInput, CreateTaskInput, PagedResult, SendMessageInput, Session, SessionEvent, Task, UpdateSessionInput } from '@melody-sync/types'
import { appendEvent, listEvents } from '../../models/history'
import { getSession } from '../../models/session'
import { createTask, getTask } from '../../models/task'
import { submitSessionMessage } from '../../runtime/session-runner'
import { createSessionWithEffects, deleteSessionWithEffects, listSessionViews, updateSessionWithEffects } from '../../services/sessions'

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

function errBody(error: string): ApiResult<never> {
  return { ok: false, error }
}

function sc(n: number): ContentfulStatusCode {
  return n as ContentfulStatusCode
}

const CreateSessionSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().optional(),
  tool: z.string().optional(),
  model: z.string().nullable().optional(),
  effort: z.string().nullable().optional(),
  thinking: z.boolean().optional(),
  claudeSessionId: z.string().nullable().optional(),
  codexThreadId: z.string().nullable().optional(),
})

const UpdateSessionSchema = z.object({
  name: z.string().optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  tool: z.string().optional(),
  model: z.string().nullable().optional(),
  effort: z.string().nullable().optional(),
  thinking: z.boolean().optional(),
  claudeSessionId: z.string().nullable().optional(),
  codexThreadId: z.string().nullable().optional(),
  autoRenamePending: z.boolean().optional(),
})

const SendMessageSchema = z.object({
  text: z.string().min(1),
  requestId: z.string().optional(),
  tool: z.string().optional(),
  model: z.string().nullable().optional(),
  effort: z.string().nullable().optional(),
  thinking: z.boolean().optional(),
  attachments: z
    .array(
      z.object({
        assetId: z.string(),
        filename: z.string(),
        savedPath: z.string(),
        mimeType: z.string(),
      }),
    )
    .optional(),
})

export const sessionsRouter = new Hono()

sessionsRouter.get('/sessions', (c) => {
  const projectId = c.req.query('projectId')
  const archived = c.req.query('archived') === 'true'
  try {
    return c.json(ok<Session[]>(listSessionViews(projectId, archived)))
  } catch (error) {
    return c.json(errBody(String(error)), sc(500))
  }
})

sessionsRouter.get('/sessions/:id', (c) => {
  const session = getSession(c.req.param('id'))
  if (!session) return c.json(errBody('Session not found'), sc(404))
  return c.json(ok(session))
})

sessionsRouter.post('/sessions', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(errBody('Invalid JSON body'), sc(400))
  }
  const parsed = CreateSessionSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))
  try {
    return c.json(ok(createSessionWithEffects(parsed.data as CreateSessionInput)), sc(201))
  } catch (error) {
    return c.json(errBody(String(error)), sc(500))
  }
})

sessionsRouter.patch('/sessions/:id', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(errBody('Invalid JSON body'), sc(400))
  }
  const parsed = UpdateSessionSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))
  try {
    return c.json(ok(updateSessionWithEffects(c.req.param('id'), parsed.data as UpdateSessionInput)))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(500))
  }
})

sessionsRouter.delete('/sessions/:id', (c) => {
  try {
    deleteSessionWithEffects(c.req.param('id'))
    return c.json(ok({ deleted: true }))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(500))
  }
})

sessionsRouter.get('/sessions/:id/events', (c) => {
  const id = c.req.param('id')
  const limitRaw = c.req.query('limit')
  const offsetRaw = c.req.query('offset')
  const limitParsed = limitRaw ? parseInt(limitRaw, 10) : NaN
  const offsetParsed = offsetRaw ? parseInt(offsetRaw, 10) : NaN
  const limit = !isNaN(limitParsed) && limitParsed > 0 ? Math.min(limitParsed, 2000) : undefined
  const offset = !isNaN(offsetParsed) && offsetParsed >= 0 ? offsetParsed : undefined
  const items = listEvents(id, { limit, offset })
  const payload: PagedResult<SessionEvent> = {
    items,
    total: items.length,
    offset: offset ?? 0,
    limit: limit ?? items.length,
  }
  return c.json(ok(payload))
})

sessionsRouter.post('/sessions/:id/messages', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(errBody('Invalid JSON body'), sc(400))
  }
  const parsed = SendMessageSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))

  const session = getSession(c.req.param('id'))
  if (!session) return c.json(errBody('Session not found'), sc(404))

  try {
    return c.json(ok(submitSessionMessage({
      sessionId: session.id,
      ...(parsed.data as SendMessageInput),
    })))
  } catch (error) {
    const message = String(error)
    appendEvent(session.id, {
      timestamp: Date.now(),
      type: 'status',
      content: `error: ${message}`,
    })
    return c.json(errBody(message), sc(500))
  }
})

const CreateTaskFromSessionSchema = z.object({
  title: z.string().min(1),
  assignee: z.enum(['ai', 'human']),
  description: z.string().optional(),
  kind: z.enum(['once', 'scheduled', 'recurring']).optional(),
  waitingInstructions: z.string().optional(),
  reviewOnComplete: z.boolean().optional(),
})

sessionsRouter.post('/sessions/:id/create-task', async (c) => {
  const session = getSession(c.req.param('id'))
  if (!session) return c.json(errBody('Session not found'), sc(404))

  let body: unknown
  try { body = await c.req.json() } catch {
    return c.json(errBody('Invalid JSON body'), sc(400))
  }
  const parsed = CreateTaskFromSessionSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))

  const task = createTask({
    projectId: session.projectId,
    originSessionId: session.id,
    sessionId: session.id,
    title: parsed.data.title,
    description: parsed.data.description,
    assignee: parsed.data.assignee,
    kind: parsed.data.kind ?? 'once',
    createdBy: 'human',
    waitingInstructions: parsed.data.waitingInstructions,
    reviewOnComplete: parsed.data.reviewOnComplete,
    executorOptions: parsed.data.assignee === 'ai' ? { continueSession: true } : undefined,
  } as CreateTaskInput)

  return c.json(ok<Task>(task), sc(201))
})
