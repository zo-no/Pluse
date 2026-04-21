import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import type { ApiResult, Domain, Project } from '@pluse/types'
import {
  createDefaultDomainsWithEffects,
  createDomainWithEffects,
  deleteDomainWithEffects,
  listDomainViews,
  updateDomainWithEffects,
} from '../../services/domains'
import { listVisibleProjects } from '../../services/projects'

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

export type DomainWithProjects = Domain & { projects: Project[] }

domainsRouter.get('/domains', (c) => {
  try {
    const withProjects = c.req.query('withProjects') === 'true'
    if (withProjects) {
      const domains = listDomainViews({ includeDeleted: c.req.query('deleted') === 'true' })
      const projects = listVisibleProjects()
      const byDomainId = new Map<string, Project[]>()
      const ungrouped: Project[] = []
      for (const p of projects) {
        if (p.domainId) {
          const arr = byDomainId.get(p.domainId) ?? []
          arr.push(p)
          byDomainId.set(p.domainId, arr)
        } else {
          ungrouped.push(p)
        }
      }
      const result: DomainWithProjects[] = [
        ...domains.map((d) => ({ ...d, projects: byDomainId.get(d.id) ?? [] })),
        { id: null as unknown as string, name: '未分组', description: undefined, icon: undefined, color: undefined, orderIndex: 9999, deleted: false, deletedAt: undefined, createdAt: '', updatedAt: '', projects: ungrouped },
      ]
      return c.json(ok<DomainWithProjects[]>(result))
    }
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
