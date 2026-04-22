import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import type { ApiResult, SessionCategory } from '@pluse/types'
import {
  createSessionCategoryWithEffects,
  deleteSessionCategoryWithEffects,
  listSessionCategoryViews,
  updateSessionCategoryWithEffects,
} from '../../services/session-categories'

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

function errBody(error: string): ApiResult<never> {
  return { ok: false, error }
}

function sc(n: number): ContentfulStatusCode {
  return n as ContentfulStatusCode
}

const SessionCategoryCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  collapsed: z.boolean().optional(),
})

const SessionCategoryPatchSchema = z.object({
  name: z.string().min(1).nullable().optional(),
  description: z.string().nullable().optional(),
  collapsed: z.boolean().optional(),
})

export const sessionCategoriesRouter = new Hono()

sessionCategoriesRouter.get('/projects/:id/session-categories', (c) => {
  try {
    return c.json(ok<SessionCategory[]>(listSessionCategoryViews(c.req.param('id'))))
  } catch (error) {
    return c.json(errBody(String(error)), sc(500))
  }
})

sessionCategoriesRouter.post('/projects/:id/session-categories', async (c) => {
  const body = await c.req.json().catch(() => undefined)
  const parsed = SessionCategoryCreateSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))
  try {
    return c.json(ok(createSessionCategoryWithEffects({
      projectId: c.req.param('id'),
      ...parsed.data,
    })), sc(201))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})

sessionCategoriesRouter.patch('/session-categories/:id', async (c) => {
  const body = await c.req.json().catch(() => undefined)
  const parsed = SessionCategoryPatchSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))
  try {
    return c.json(ok(updateSessionCategoryWithEffects(c.req.param('id'), parsed.data)))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})

sessionCategoriesRouter.delete('/session-categories/:id', (c) => {
  try {
    deleteSessionCategoryWithEffects(c.req.param('id'))
    return c.json(ok({ deleted: true }))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})
