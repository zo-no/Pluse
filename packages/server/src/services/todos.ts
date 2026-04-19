import type { CreateTodoInput, Todo, UpdateTodoInput } from '@pluse/types'
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

export function createTodoWithEffects(input: CreateTodoInput): Todo {
  const todo = createTodo(input)
  emitTodoUpdated(todo)
  return todo
}

export function updateTodoWithEffects(id: string, input: UpdateTodoInput): Todo {
  const todo = updateTodo(id, input)
  emitTodoUpdated(todo)
  return todo
}

export function deleteTodoWithEffects(id: string): void {
  const todo = getTodo(id)
  if (!todo) throw new Error(`Todo not found: ${id}`)
  updateTodo(id, { deleted: true })
  emitTodoUpdated(getTodo(id)!)
  emit({
    type: 'todo_deleted',
    data: {
      todoId: id,
      projectId: todo.projectId,
      originQuestId: todo.originQuestId,
    },
  })
}
