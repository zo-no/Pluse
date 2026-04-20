import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import type { ApiResult, Domain } from '@pluse/types'
import {
  createDefaultDomainsWithEffects,
  createDomainWithEffects,
  deleteDomainWithEffects,
  listDomainViews,
  updateDomainWithEffects,
} from '../../services/domains'

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

function errBody(error: string): ApiResult<never> {
  return { ok: false, error }
}

function sc(n: number): ContentfulStatusCode {
  return n as ContentfulStatusCode
}

const DomainCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  orderIndex: z.number().int().optional(),
})

const DomainPatchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  orderIndex: z.number().int().nullable().optional(),
})

export const domainsRouter = new Hono()

domainsRouter.get('/domains', (c) => {
  try {
    return c.json(ok<Domain[]>(listDomainViews({ includeDeleted: c.req.query('deleted') === 'true' })))
  } catch (error) {
    return c.json(errBody(String(error)), sc(500))
  }
})

domainsRouter.post('/domains', async (c) => {
  const body = await c.req.json().catch(() => undefined)
  const parsed = DomainCreateSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))
  try {
    return c.json(ok(createDomainWithEffects(parsed.data)), sc(201))
  } catch (error) {
    return c.json(errBody(String(error)), sc(400))
  }
})

domainsRouter.post('/domains/defaults', (c) => {
  try {
    return c.json(ok<Domain[]>(createDefaultDomainsWithEffects()), sc(201))
  } catch (error) {
    return c.json(errBody(String(error)), sc(400))
  }
})

domainsRouter.patch('/domains/:id', async (c) => {
  const body = await c.req.json().catch(() => undefined)
  const parsed = DomainPatchSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))
  try {
    return c.json(ok(updateDomainWithEffects(c.req.param('id'), parsed.data)))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})

domainsRouter.delete('/domains/:id', (c) => {
  try {
    deleteDomainWithEffects(c.req.param('id'))
    return c.json(ok({ deleted: true }))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})
