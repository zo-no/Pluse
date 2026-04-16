import type { CreateTaskInput, ListTasksFilter, Task, UpdateTaskInput } from '@melody-sync/types'
import { createTaskOp, getTaskOps } from '../models/task-op'
import { getTaskLogs } from '../models/task-log'
import { createTask, deleteTask, getBlockedByTask, getTask, listTasks, updateTask } from '../models/task'
import { emit } from './events'
import { cancelTaskExecution, registerTask, runTask, unregisterTask } from './scheduler'

export function listTaskViews(filter: ListTasksFilter = {}): Task[] {
  return listTasks(filter)
}

export function getTaskView(id: string): Task | null {
  return getTask(id)
}

export function createTaskWithEffects(input: CreateTaskInput): Task {
  const task = createTask(input)
  createTaskOp({ taskId: task.id, op: 'created', actor: input.createdBy === 'ai' ? 'ai' : 'human' })
  registerTask(task)
  emit({ type: 'task_created', data: { taskId: task.id, projectId: task.projectId, sessionId: task.sessionId } })
  return task
}

export function updateTaskWithEffects(id: string, input: UpdateTaskInput): Task {
  const task = updateTask(id, input)
  if (!task) throw new Error(`Task not found: ${id}`)
  registerTask(task)
  emit({ type: 'task_updated', data: { taskId: task.id, projectId: task.projectId, sessionId: task.sessionId } })
  return task
}

export function deleteTaskWithEffects(id: string): void {
  const task = getTask(id)
  if (!task) throw new Error(`Task not found: ${id}`)
  createTaskOp({ taskId: id, op: 'deleted', actor: 'human' })
  unregisterTask(id)
  deleteTask(id)
  emit({ type: 'task_deleted', data: { taskId: id, projectId: task.projectId, sessionId: task.sessionId } })
}

export async function runTaskNow(id: string, triggeredBy: 'manual' | 'scheduler' | 'api' | 'cli' = 'api'): Promise<void> {
  await runTask(id, triggeredBy)
}

export async function markTaskDone(id: string, output?: string): Promise<Task> {
  const task = getTask(id)
  if (!task) throw new Error(`Task not found: ${id}`)
  if (task.assignee !== 'human') throw new Error('Only human tasks can be marked done')

  const updated = updateTask(id, { status: 'done', completionOutput: output ?? null })
  createTaskOp({ taskId: id, op: 'done', fromStatus: task.status, toStatus: 'done', actor: 'human' })

  const blocked = getBlockedByTask(id)
  for (const dependent of blocked) {
    updateTask(dependent.id, {
      status: 'pending',
      blockedByTaskId: null,
      completionOutput: output ?? null,
    })
    createTaskOp({
      taskId: dependent.id,
      op: 'unblocked',
      fromStatus: 'blocked',
      toStatus: 'pending',
      actor: 'human',
      note: `unblocked by human task ${id}`,
    })
    await runTask(dependent.id, 'api')
  }

  emit({ type: 'task_updated', data: { taskId: id, projectId: task.projectId, sessionId: task.sessionId } })
  return updated!
}

export function cancelTask(id: string): Task {
  const task = getTask(id)
  if (!task) throw new Error(`Task not found: ${id}`)
  const prevStatus = task.status
  cancelTaskExecution(id)
  const updated = updateTask(id, { status: 'cancelled' })
  createTaskOp({ taskId: id, op: 'cancelled', fromStatus: prevStatus, toStatus: 'cancelled', actor: 'human' })
  emit({ type: 'task_updated', data: { taskId: id, projectId: task.projectId, sessionId: task.sessionId } })
  return updated!
}

export function getTaskLogsView(id: string, limit = 20) {
  return getTaskLogs(id, limit)
}

export function getTaskOpsView(id: string, limit = 20) {
  return getTaskOps(id, limit)
}
