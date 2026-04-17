import { Cron } from 'croner'
import type { RecurringConfig, Task } from '@melody-sync/types'
import { createTaskOp } from '../models/task-op'
import { createTaskLog, updateTaskLogCompleted } from '../models/task-log'
import { createTask, getBlockedByTask, getTask, listTasks, reconcileRunningTasks, updateTask } from '../models/task'
import { emit } from './events'
import { executeTask, killTask } from './task-executor'

const cronJobs = new Map<string, Cron>()
const runningTasks = new Set<string>()

export function reconcile(): void {
  const stale = reconcileRunningTasks()
  for (const task of stale) {
    createTaskOp({
      taskId: task.id,
      op: 'status_changed',
      fromStatus: 'running',
      toStatus: 'pending',
      actor: 'scheduler',
      note: 'reconciled on startup',
    })
  }
}

async function unblockDependents(completedTaskId: string, output: string): Promise<void> {
  const blocked = getBlockedByTask(completedTaskId)
  for (const task of blocked) {
    updateTask(task.id, {
      status: 'pending',
      blockedByTaskId: null,
      completionOutput: output || null,
    })
    createTaskOp({
      taskId: task.id,
      op: 'unblocked',
      fromStatus: 'blocked',
      toStatus: 'pending',
      actor: 'scheduler',
      note: `unblocked by ${completedTaskId}`,
    })
    await runTask(task.id, 'scheduler')
  }
}

export async function runTask(
  taskId: string,
  triggeredBy: 'manual' | 'scheduler' | 'api' | 'cli',
): Promise<void> {
  const task = getTask(taskId)
  if (!task) return
  if (!task.enabled || task.assignee !== 'ai') return
  if (runningTasks.has(taskId) || task.status === 'running' || task.status === 'blocked') {
    createTaskLog({
      taskId,
      status: 'skipped',
      triggeredBy,
      skipReason: task.status === 'blocked' ? 'blocked' : 'already running',
      startedAt: new Date().toISOString(),
    })
    return
  }

  updateTask(taskId, { status: 'running' })
  emit({ type: 'task_updated', data: { taskId, projectId: task.projectId, sessionId: task.sessionId } })
  createTaskOp({
    taskId,
    op: 'triggered',
    fromStatus: task.status,
    toStatus: 'running',
    actor: triggeredBy === 'scheduler' ? 'scheduler' : 'human',
  })

  const log = createTaskLog({
    taskId,
    status: 'success',
    triggeredBy,
    startedAt: new Date().toISOString(),
  })

  runningTasks.add(taskId)
  try {
    const result = await executeTask(task, triggeredBy)
    const fresh = getTask(taskId)
    if (!fresh) return

    const finalStatus = result.success ? 'success' : 'failed'
    updateTaskLogCompleted(log.id, finalStatus, result.output, result.error)

    const nextStatus = fresh.kind === 'recurring' && result.success ? 'pending' : result.success ? 'done' : 'failed'
    updateTask(taskId, {
      status: nextStatus,
      lastSessionId: result.sessionId ?? null,
    })
    emit({ type: 'task_updated', data: { taskId, projectId: fresh.projectId, sessionId: fresh.sessionId } })
    createTaskOp({
      taskId,
      op: result.success ? 'done' : 'status_changed',
      fromStatus: 'running',
      toStatus: nextStatus,
      actor: 'scheduler',
    })

    if (fresh.kind === 'recurring' && fresh.scheduleConfig?.kind === 'recurring') {
      const cfg = fresh.scheduleConfig as RecurringConfig
      const job = cronJobs.get(taskId)
      updateTask(taskId, {
        scheduleConfig: {
          ...cfg,
          lastRunAt: new Date().toISOString(),
          nextRunAt: job?.nextRun()?.toISOString(),
        },
      })
    }

    if (result.success && fresh.reviewOnComplete) {
      createTask({
        projectId: fresh.projectId,
        originSessionId: fresh.sessionId,
        title: `Review: ${fresh.title}`,
        assignee: 'human',
        kind: 'once',
        createdBy: 'system',
        waitingInstructions: `Task "${fresh.title}" completed. Please review the output and mark done.`,
      })
    }

    if (result.success) {
      await unblockDependents(taskId, result.output)
    }
  } finally {
    runningTasks.delete(taskId)
  }
}

function scheduleSingleTask(task: Task): void {
  if (task.assignee !== 'ai' || !task.enabled) return

  const existing = cronJobs.get(task.id)
  if (existing) {
    existing.stop()
    cronJobs.delete(task.id)
  }

  if (task.kind === 'scheduled') {
    const cfg = task.scheduleConfig
    if (!cfg || cfg.kind !== 'scheduled') return
    const runAt = new Date(cfg.scheduledAt)
    if (runAt <= new Date()) return
    const job = new Cron(runAt, { maxRuns: 1 }, async () => {
      await runTask(task.id, 'scheduler')
      cronJobs.delete(task.id)
    })
    cronJobs.set(task.id, job)
    return
  }

  if (task.kind === 'recurring') {
    const cfg = task.scheduleConfig
    if (!cfg || cfg.kind !== 'recurring') return
    const job = new Cron(cfg.cron, { timezone: cfg.timezone }, async () => {
      await runTask(task.id, 'scheduler')
    })
    cronJobs.set(task.id, job)
    updateTask(task.id, {
      scheduleConfig: {
        ...cfg,
        nextRunAt: job.nextRun()?.toISOString(),
      },
    })
  }
}

export function startScheduler(): void {
  const tasks = listTasks({ assignee: 'ai' })
  for (const task of tasks) {
    if (task.kind !== 'once') {
      scheduleSingleTask(task)
    }
  }
}

export function registerTask(task: Task): void {
  if (task.kind !== 'once') {
    scheduleSingleTask(task)
  }
}

export function unregisterTask(taskId: string): void {
  const job = cronJobs.get(taskId)
  if (job) {
    job.stop()
    cronJobs.delete(taskId)
  }
}

export function stopScheduler(): void {
  for (const job of cronJobs.values()) job.stop()
  cronJobs.clear()
}

export function cancelTaskExecution(taskId: string): boolean {
  return killTask(taskId)
}
