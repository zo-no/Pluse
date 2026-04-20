import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import type { ApiResult, CreateTodoInput, Todo, UpdateTodoInput } from '@pluse/types'
import { getTodo, listProjectTags, listTodos } from '../../models/todo'
import { createTodoWithEffects, deleteTodoWithEffects, listTodoViews, updateTodoWithEffects } from '../../services/todos'

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

function errBody(error: string): ApiResult<never> {
  return { ok: false, error }
}

function sc(n: number): ContentfulStatusCode {
  return n as ContentfulStatusCode
}

const TodoSchema = z.object({
  projectId: z.string().min(1),
  createdBy: z.enum(['human', 'ai', 'system']).optional(),
  originQuestId: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  waitingInstructions: z.string().optional(),
  dueAt: z.string().optional(),
  repeat: z.enum(['none', 'daily', 'weekly', 'monthly']).optional(),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(['pending', 'done']).optional(),
  deleted: z.boolean().optional(),
})

const TodoPatchSchema = z.object({
  originQuestId: z.string().nullable().optional(),
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  waitingInstructions: z.string().nullable().optional(),
  dueAt: z.string().nullable().optional(),
  repeat: z.enum(['none', 'daily', 'weekly', 'monthly']).optional(),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
  tags: z.array(z.string()).nullable().optional(),
  status: z.enum(['pending', 'done']).optional(),
  deleted: z.boolean().optional(),
})

export const todosRouter = new Hono()

todosRouter.get('/todos', (c) => {
  const deletedQuery = c.req.query('deleted')
  const deleted = deletedQuery === 'true'
  const tagsQuery = c.req.query('tags')
  const tags = tagsQuery ? tagsQuery.split(',').map((t) => t.trim()).filter(Boolean) : undefined
  const priority = c.req.query('priority') as Todo['priority'] | undefined
  return c.json(ok<Todo[]>(listTodoViews({
    projectId: c.req.query('projectId') || undefined,
    status: (c.req.query('status') as Todo['status'] | undefined) || undefined,
    deleted,
    tags,
    priority,
  })))
})

// Must be registered before /todos/:id to avoid route conflict
todosRouter.get('/todos/tags', (c) => {
  const projectId = c.req.query('projectId')
  if (!projectId) return c.json(errBody('projectId is required'), sc(400))
  const tags = listProjectTags(projectId)
  return c.json(ok({ tags }))
})

todosRouter.get('/todos/:id', (c) => {
  const todo = getTodo(c.req.param('id'))
  if (!todo) return c.json(errBody('Todo not found'), sc(404))
  return c.json(ok(todo))
})

todosRouter.post('/todos', async (c) => {
  const body = await c.req.json().catch(() => undefined)
  const parsed = TodoSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))
  try {
    return c.json(ok(createTodoWithEffects(parsed.data as CreateTodoInput)), sc(201))
  } catch (error) {
    return c.json(errBody(String(error)), sc(400))
  }
})

todosRouter.patch('/todos/:id', async (c) => {
  const body = await c.req.json().catch(() => undefined)
  const parsed = TodoPatchSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))
  try {
    return c.json(ok(updateTodoWithEffects(c.req.param('id'), parsed.data as UpdateTodoInput)))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})

todosRouter.delete('/todos/:id', (c) => {
  try {
    deleteTodoWithEffects(c.req.param('id'))
    return c.json(ok({ deleted: true }))
  } catch (error) {
    const message = String(error)
    return c.json(errBody(message), message.includes('not found') ? sc(404) : sc(400))
  }
})
