import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import type { ApiResult, Project, ProjectOverview, TokenUsageSummary } from '@pluse/types'
import { getProject } from '../../models/project'
import { getProjectTokenSummary } from '../../models/run'
import { archiveProject, deleteProjectWithCascade, getProjectOverview, listVisibleProjects, openProject, updateProject } from '../../services/projects'

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

function errBody(error: string): ApiResult<never> {
  return { ok: false, error }
}

function sc(n: number): ContentfulStatusCode {
  return n as ContentfulStatusCode
}

const OpenProjectSchema = z.object({
  workDir: z.string().min(1),
  name: z.string().min(1).optional(),
  goal: z.string().optional(),
  systemPrompt: z.string().optional(),
  domainId: z.string().nullable().optional(),
  pinned: z.boolean().optional(),
})

const UpdateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  goal: z.string().nullable().optional(),
  systemPrompt: z.string().nullable().optional(),
  domainId: z.string().nullable().optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
})

export const projectsRouter = new Hono()

projectsRouter.get('/projects', (c) => {
  try {
    return c.json(ok<Project[]>(listVisibleProjects()))
  } catch (error) {
    return c.json(errBody(String(error)), sc(500))
  }
})

projectsRouter.post('/projects/open', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(errBody('Invalid JSON body'), sc(400))
  }
  const parsed = OpenProjectSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))
  try {
    return c.json(ok<Project>(openProject(parsed.data)), sc(201))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('Domain not found') ? sc(400) : sc(500))
  }
})

projectsRouter.get('/projects/:id', (c) => {
  const project = getProject(c.req.param('id'))
  if (!project || project.visibility === 'system') {
    return c.json(errBody('Project not found'), sc(404))
  }
  return c.json(ok(project))
})

projectsRouter.get('/projects/:id/overview', (c) => {
  try {
    const overview = getProjectOverview(c.req.param('id'))
    if (!overview || overview.project.visibility === 'system') {
      return c.json(errBody('Project not found'), sc(404))
    }
    return c.json(ok<ProjectOverview>(overview))
  } catch (error) {
    return c.json(errBody(String(error)), sc(500))
  }
})

projectsRouter.patch('/projects/:id', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(errBody('Invalid JSON body'), sc(400))
  }
  const parsed = UpdateProjectSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))
  try {
    return c.json(ok(updateProject(c.req.param('id'), parsed.data)))
  } catch (error) {
    const message = String(error)
    if (message.includes('Domain not found')) {
      return c.json(errBody(message), sc(400))
    }
    return c.json(errBody(message), message.includes('Project not found') ? sc(404) : sc(400))
  }
})

projectsRouter.post('/projects/:id/archive', (c) => {
  try {
    return c.json(ok(archiveProject(c.req.param('id'))))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})

projectsRouter.delete('/projects/:id', (c) => {
  const id = c.req.param('id')
  const project = getProject(id)
  if (!project) return c.json(errBody('Project not found'), sc(404))
  try {
    deleteProjectWithCascade(id)
    return c.json(ok({ deleted: true }))
  } catch (error) {
    return c.json(errBody(String(error)), sc(500))
  }
})

projectsRouter.get('/projects/:id/token-summary', (c) => {
  const id = c.req.param('id')
  const project = getProject(id)
  if (!project) return c.json(errBody('Project not found'), sc(404))
  try {
    return c.json(ok<TokenUsageSummary>(getProjectTokenSummary(id)))
  } catch (error) {
    return c.json(errBody(String(error)), sc(500))
  }
})
