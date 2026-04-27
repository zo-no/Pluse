import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import type {
  ApiResult,
  CreateReminderInput,
  Reminder,
  ReminderProjectPrioritySetting,
  SetReminderProjectPriorityResult,
  UpdateReminderInput,
} from '@pluse/types'
import { getReminder } from '../../models/reminder'
import {
  createReminderWithEffects,
  deleteReminderWithEffects,
  listReminderProjectPriorities,
  listReminderViews,
  setReminderProjectPriorityWithEffects,
  updateReminderWithEffects,
} from '../../services/reminders'

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

function errBody(error: string): ApiResult<never> {
  return { ok: false, error }
}

function sc(n: number): ContentfulStatusCode {
  return n as ContentfulStatusCode
}

const ReminderTypeSchema = z.enum(['custom', 'review', 'follow_up', 'needs_input', 'failure'])
const ReminderPrioritySchema = z.enum(['urgent', 'high', 'normal', 'low'])
const ReminderProjectPrioritySchema = z.enum(['mainline', 'priority', 'normal', 'low'])
const ReminderOrderSchema = z.enum(['attention', 'time'])

const ReminderSchema = z.object({
  projectId: z.string().min(1),
  createdBy: z.enum(['human', 'ai', 'system']).optional(),
  originQuestId: z.string().nullable().optional(),
  originRunId: z.string().nullable().optional(),
  type: ReminderTypeSchema.optional(),
  title: z.string().min(1),
  body: z.string().optional(),
  remindAt: z.string().optional(),
  priority: ReminderPrioritySchema.optional(),
})

const ReminderPatchSchema = z.object({
  originQuestId: z.string().nullable().optional(),
  originRunId: z.string().nullable().optional(),
  type: ReminderTypeSchema.optional(),
  title: z.string().optional(),
  body: z.string().nullable().optional(),
  remindAt: z.string().nullable().optional(),
  priority: ReminderPrioritySchema.optional(),
})

const ReminderProjectPriorityPatchSchema = z.object({
  priority: ReminderProjectPrioritySchema,
})

export const remindersRouter = new Hono()

remindersRouter.get('/reminders', (c) => {
  const timeQuery = c.req.query('time')
  const time = timeQuery === 'due' || timeQuery === 'future' || timeQuery === 'all' ? timeQuery : undefined
  const orderParsed = ReminderOrderSchema.safeParse(c.req.query('order') || undefined)
  return c.json(ok<Reminder[]>(listReminderViews({
    projectId: c.req.query('projectId') || undefined,
    type: (c.req.query('type') as Reminder['type'] | undefined) || undefined,
    originQuestId: c.req.query('originQuestId') || undefined,
    originRunId: c.req.query('originRunId') || undefined,
    priority: (c.req.query('priority') as Reminder['priority'] | undefined) || undefined,
    time,
    order: orderParsed.success ? orderParsed.data : undefined,
  })))
})

remindersRouter.get('/reminders/project-priorities', (c) => {
  return c.json(ok<ReminderProjectPrioritySetting[]>(listReminderProjectPriorities()))
})

remindersRouter.patch('/reminders/project-priorities/:projectId', async (c) => {
  const body = await c.req.json().catch(() => undefined)
  const parsed = ReminderProjectPriorityPatchSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))
  try {
    return c.json(ok<SetReminderProjectPriorityResult>(
      setReminderProjectPriorityWithEffects(c.req.param('projectId'), parsed.data.priority),
    ))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})

remindersRouter.get('/reminders/:id', (c) => {
  const reminder = getReminder(c.req.param('id'))
  if (!reminder) return c.json(errBody('Reminder not found'), sc(404))
  return c.json(ok(reminder))
})

remindersRouter.post('/reminders', async (c) => {
  const body = await c.req.json().catch(() => undefined)
  const parsed = ReminderSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))
  try {
    return c.json(ok(createReminderWithEffects(parsed.data as CreateReminderInput)), sc(201))
  } catch (error) {
    return c.json(errBody(String(error)), sc(400))
  }
})

remindersRouter.patch('/reminders/:id', async (c) => {
  const body = await c.req.json().catch(() => undefined)
  const parsed = ReminderPatchSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))
  try {
    return c.json(ok(updateReminderWithEffects(c.req.param('id'), parsed.data as UpdateReminderInput)))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})

remindersRouter.delete('/reminders/:id', (c) => {
  try {
    deleteReminderWithEffects(c.req.param('id'))
    return c.json(ok({ deleted: true }))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})
