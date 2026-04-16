import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import type { ApiResult, CreateTaskInput, ListTasksFilter, Task, UpdateTaskInput } from '@melody-sync/types'
import { getTaskRuns } from '../../models/task-run'
import { createTaskWithEffects, deleteTaskWithEffects, getTaskLogsView, getTaskOpsView, getTaskView, listTaskViews, markTaskDone, runTaskNow, updateTaskWithEffects, cancelTask } from '../../services/tasks'

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

function errBody(error: string): ApiResult<never> {
  return { ok: false, error }
}

function sc(n: number): ContentfulStatusCode {
  return n as ContentfulStatusCode
}

const TaskSchema = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  assignee: z.enum(['ai', 'human']),
  kind: z.enum(['once', 'scheduled', 'recurring']),
  surface: z.enum(['chat_short', 'project']),
  visibleInChat: z.boolean(),
  origin: z.enum(['agent', 'manual', 'scheduler', 'system']),
  originRunId: z.string().optional(),
  order: z.number().optional(),
  scheduleConfig: z.any().optional(),
  executor: z.any().optional(),
  executorOptions: z.any().optional(),
  waitingInstructions: z.string().optional(),
  sourceTaskId: z.string().optional(),
  blockedByTaskId: z.string().optional(),
  enabled: z.boolean().optional(),
  createdBy: z.enum(['human', 'ai', 'system']).optional(),
})

const TaskPatchSchema = z.object({
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  status: z.string().optional(),
  surface: z.enum(['chat_short', 'project']).optional(),
  visibleInChat: z.boolean().optional(),
  origin: z.enum(['agent', 'manual', 'scheduler', 'system']).optional(),
  originRunId: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  scheduleConfig: z.any().nullable().optional(),
  executor: z.any().nullable().optional(),
  executorOptions: z.any().nullable().optional(),
  enabled: z.boolean().optional(),
  completionOutput: z.string().nullable().optional(),
  blockedByTaskId: z.string().nullable().optional(),
  lastSessionId: z.string().nullable().optional(),
})

export const tasksRouter = new Hono()

tasksRouter.get('/tasks', (c) => {
  const filter: ListTasksFilter = {
    projectId: c.req.query('projectId') || undefined,
    sessionId: c.req.query('sessionId') || undefined,
    kind: c.req.query('kind') as ListTasksFilter['kind'],
    status: c.req.query('status') as ListTasksFilter['status'],
    assignee: c.req.query('assignee') as ListTasksFilter['assignee'],
    surface: c.req.query('surface') as ListTasksFilter['surface'],
    visibleInChat: c.req.query('visibleInChat') === undefined
      ? undefined
      : c.req.query('visibleInChat') === 'true',
  }
  return c.json(ok<Task[]>(listTaskViews(filter)))
})

tasksRouter.post('/tasks', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(errBody('Invalid JSON body'), sc(400))
  }
  const parsed = TaskSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))
  try {
    return c.json(ok(createTaskWithEffects(parsed.data as CreateTaskInput)), sc(201))
  } catch (error) {
    return c.json(errBody(String(error)), sc(500))
  }
})

tasksRouter.get('/tasks/:id', (c) => {
  const task = getTaskView(c.req.param('id'))
  if (!task) return c.json(errBody('Task not found'), sc(404))
  return c.json(ok(task))
})

tasksRouter.patch('/tasks/:id', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(errBody('Invalid JSON body'), sc(400))
  }
  const parsed = TaskPatchSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))
  try {
    return c.json(ok(updateTaskWithEffects(c.req.param('id'), parsed.data as UpdateTaskInput)))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})

tasksRouter.delete('/tasks/:id', (c) => {
  try {
    deleteTaskWithEffects(c.req.param('id'))
    return c.json(ok({ deleted: true }))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})

tasksRouter.post('/tasks/:id/run', async (c) => {
  try {
    await runTaskNow(c.req.param('id'), 'api')
    return c.json(ok({ ok: true }))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})

tasksRouter.post('/tasks/:id/done', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    return c.json(ok(await markTaskDone(c.req.param('id'), (body as { output?: string }).output)))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})

tasksRouter.post('/tasks/:id/cancel', (c) => {
  try {
    return c.json(ok(cancelTask(c.req.param('id'))))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})

tasksRouter.get('/tasks/:id/logs', (c) => {
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : 20
  return c.json(ok(getTaskLogsView(c.req.param('id'), limit)))
})

tasksRouter.get('/tasks/:id/ops', (c) => {
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : 20
  return c.json(ok(getTaskOpsView(c.req.param('id'), limit)))
})

tasksRouter.get('/tasks/:id/runs', (c) => {
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : 20
  return c.json(ok(getTaskRuns(c.req.param('id'), limit)))
})
