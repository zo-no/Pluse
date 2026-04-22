import type { CreateTodoInput, Todo, TodoRepeat, UpdateTodoInput } from '@pluse/types'
import { createProjectActivity } from '../models/project-activity'
import { createTodo, getTodo, listTodos, updateTodo } from '../models/todo'
import { emit } from './events'

function emitTodoUpdated(todo: Todo): void {
  emit({
    type: 'todo_updated',
    data: {
      todoId: todo.id,
      projectId: todo.projectId,
      originQuestId: todo.originQuestId,
    },
  })
}

export function listTodoViews(filter: Parameters<typeof listTodos>[0] = {}): Todo[] {
  return listTodos(filter)
}

function todoActivityTitle(todo: Todo): string {
  return todo.title.trim() || todo.id
}

function nextRecurringDueAt(base: string | undefined, repeat: TodoRepeat): string | undefined {
  if (repeat === 'none') return undefined
  const reference = base ? new Date(base) : new Date()
  if (Number.isNaN(reference.getTime())) return undefined
  const next = new Date(reference)
  if (repeat === 'daily') {
    next.setUTCDate(next.getUTCDate() + 1)
  } else if (repeat === 'weekly') {
    next.setUTCDate(next.getUTCDate() + 7)
  } else if (repeat === 'monthly') {
    next.setUTCMonth(next.getUTCMonth() + 1)
  }
  return next.toISOString()
}

export function createTodoWithEffects(input: CreateTodoInput): Todo {
  const todo = createTodo(input)
  createProjectActivity({
    projectId: todo.projectId,
    subjectType: 'todo',
    subjectId: todo.id,
    questId: todo.originQuestId,
    title: todoActivityTitle(todo),
    op: 'created',
    actor: input.createdBy ?? 'human',
    toStatus: todo.status,
  })
  emitTodoUpdated(todo)
  return todo
}

function hasTag(tags: string[] | undefined, value: string): boolean {
  return (tags ?? []).some((tag) => tag.trim().toLowerCase() === value)
}

export function findOpenReviewTodoForQuest(projectId: string, questId: string): Todo | null {
  const todos = listTodos({
    projectId,
    status: 'pending',
    deleted: false,
    tags: ['review'],
  })
  return todos.find((todo) => todo.originQuestId === questId) ?? null
}

export function ensureReviewTodoWithEffects(input: CreateTodoInput): Todo {
  if (!input.originQuestId || !hasTag(input.tags, 'review')) {
    return createTodoWithEffects(input)
  }

  const existing = findOpenReviewTodoForQuest(input.projectId, input.originQuestId)
  if (existing) return existing
  return createTodoWithEffects(input)
}

export function updateTodoWithEffects(id: string, input: UpdateTodoInput): Todo {
  const before = getTodo(id)
  if (!before) throw new Error(`Todo not found: ${id}`)
  const todo = updateTodo(id, input)
  const shouldCreateNextRecurringTodo = before.status !== 'done' && todo.status === 'done' && todo.repeat !== 'none' && !todo.deleted
  if (!before.deleted && todo.deleted) {
    createProjectActivity({
      projectId: todo.projectId,
      subjectType: 'todo',
      subjectId: todo.id,
      questId: todo.originQuestId,
      title: todoActivityTitle(todo),
      op: 'deleted',
      actor: 'human',
      fromStatus: before.status,
      toStatus: todo.status,
    })
  } else if (before.status !== todo.status) {
    createProjectActivity({
      projectId: todo.projectId,
      subjectType: 'todo',
      subjectId: todo.id,
      questId: todo.originQuestId,
      title: todoActivityTitle(todo),
      op: todo.status === 'done' ? 'done' : todo.status === 'cancelled' ? 'cancelled' : 'status_changed',
      actor: 'human',
      fromStatus: before.status,
      toStatus: todo.status,
    })
  }
  if (shouldCreateNextRecurringTodo) {
    createTodoWithEffects({
      projectId: todo.projectId,
      createdBy: todo.createdBy,
      originQuestId: todo.originQuestId,
      title: todo.title,
      description: todo.description,
      waitingInstructions: todo.waitingInstructions,
      dueAt: nextRecurringDueAt(todo.dueAt, todo.repeat),
      repeat: todo.repeat,
      priority: todo.priority,
      tags: todo.tags,
      status: 'pending',
    })
  }
  emitTodoUpdated(todo)
  return todo
}

export function deleteTodoWithEffects(id: string): void {
  const todo = getTodo(id)
  if (!todo) throw new Error(`Todo not found: ${id}`)
  const updated = updateTodoWithEffects(id, { deleted: true })
  emit({
    type: 'todo_deleted',
    data: {
      todoId: id,
      projectId: updated.projectId,
      originQuestId: updated.originQuestId,
    },
  })
}
