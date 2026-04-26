import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import type { ApiResult, CreateNotificationInput, Notification, UpdateNotificationInput } from '@pluse/types'
import { getNotification } from '../../models/notification'
import {
  createNotificationWithEffects,
  deleteNotificationWithEffects,
  listNotificationViews,
  updateNotificationWithEffects,
} from '../../services/notifications'

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

function errBody(error: string): ApiResult<never> {
  return { ok: false, error }
}

function sc(n: number): ContentfulStatusCode {
  return n as ContentfulStatusCode
}

const NotificationSchema = z.object({
  projectId: z.string().min(1),
  createdBy: z.enum(['human', 'ai', 'system']).optional(),
  originQuestId: z.string().nullable().optional(),
  originRunId: z.string().nullable().optional(),
  type: z.enum(['review']),
  title: z.string().min(1),
  body: z.string().optional(),
  status: z.enum(['unread', 'read']).optional(),
  deleted: z.boolean().optional(),
})

const NotificationPatchSchema = z.object({
  title: z.string().optional(),
  body: z.string().nullable().optional(),
  status: z.enum(['unread', 'read']).optional(),
  deleted: z.boolean().optional(),
})

export const notificationsRouter = new Hono()

notificationsRouter.get('/notifications', (c) => {
  const deletedQuery = c.req.query('deleted')
  const deleted = deletedQuery === undefined ? undefined : deletedQuery === 'true'
  return c.json(ok<Notification[]>(listNotificationViews({
    projectId: c.req.query('projectId') || undefined,
    status: (c.req.query('status') as Notification['status'] | undefined) || undefined,
    deleted,
    type: (c.req.query('type') as Notification['type'] | undefined) || undefined,
    originQuestId: c.req.query('originQuestId') || undefined,
  })))
})

notificationsRouter.get('/notifications/:id', (c) => {
  const notification = getNotification(c.req.param('id'))
  if (!notification) return c.json(errBody('Notification not found'), sc(404))
  return c.json(ok(notification))
})

notificationsRouter.post('/notifications', async (c) => {
  const body = await c.req.json().catch(() => undefined)
  const parsed = NotificationSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))
  try {
    return c.json(ok(createNotificationWithEffects(parsed.data as CreateNotificationInput)), sc(201))
  } catch (error) {
    return c.json(errBody(String(error)), sc(400))
  }
})

notificationsRouter.patch('/notifications/:id', async (c) => {
  const body = await c.req.json().catch(() => undefined)
  const parsed = NotificationPatchSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))
  try {
    return c.json(ok(updateNotificationWithEffects(c.req.param('id'), parsed.data as UpdateNotificationInput)))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})

notificationsRouter.delete('/notifications/:id', (c) => {
  try {
    deleteNotificationWithEffects(c.req.param('id'))
    return c.json(ok({ deleted: true }))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})
