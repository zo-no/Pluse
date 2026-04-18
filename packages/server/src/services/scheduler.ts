import { Cron } from 'croner'
import type { Quest } from '@pluse/types'
import { getDb } from '../db'
import { getQuest, listQuests, updateQuest } from '../models/quest'
import { startQuestRun } from '../runtime/session-runner'

const cronJobs = new Map<string, Cron>()

function stopJob(id: string): void {
  const job = cronJobs.get(id)
  if (!job) return
  job.stop()
  cronJobs.delete(id)
}

export function reconcile(): void {
  const db = getDb()
  const ts = new Date().toISOString()
  db.run(
    `UPDATE runs
        SET state = 'failed',
            failure_reason = COALESCE(failure_reason, 'reconciled on startup'),
            updated_at = ?,
            completed_at = COALESCE(completed_at, ?),
            finalized_at = COALESCE(finalized_at, ?)
      WHERE state IN ('accepted', 'running')`,
    [ts, ts, ts],
  )

  for (const quest of listQuests({ deleted: false })) {
    if (!quest.activeRunId) continue
    updateQuest(quest.id, {
      activeRunId: null,
      status: quest.kind === 'task' ? 'pending' : 'idle',
    })
  }
}

export function refreshQuestSchedule(quest: Quest): void {
  stopJob(quest.id)
  if (
    quest.kind !== 'task'
    || quest.enabled === false
    || !quest.scheduleKind
    || quest.scheduleKind === 'once'
  ) {
    return
  }

  if (quest.scheduleKind === 'scheduled') {
    const runAt = quest.scheduleConfig?.runAt ? new Date(quest.scheduleConfig.runAt) : null
    if (!runAt || Number.isNaN(runAt.getTime()) || runAt.getTime() <= Date.now()) return
    const job = new Cron(runAt, { maxRuns: 1 }, async () => {
      await startQuestRun({
        questId: quest.id,
        trigger: 'automation',
        triggeredBy: 'scheduler',
      })
      cronJobs.delete(quest.id)
    })
    cronJobs.set(quest.id, job)
    updateQuest(quest.id, {
      scheduleConfig: {
        ...(quest.scheduleConfig ?? {}),
        nextRunAt: job.nextRun()?.toISOString(),
      },
    })
    return
  }

  const cronExpr = quest.scheduleConfig?.cron?.trim()
  if (!cronExpr) return
  const job = new Cron(cronExpr, { timezone: quest.scheduleConfig?.timezone }, async () => {
    await startQuestRun({
      questId: quest.id,
      trigger: 'automation',
      triggeredBy: 'scheduler',
    })
    const fresh = getQuest(quest.id)
    if (!fresh) return
    updateQuest(quest.id, {
      scheduleConfig: {
        ...(fresh.scheduleConfig ?? {}),
        lastRunAt: new Date().toISOString(),
        nextRunAt: job.nextRun()?.toISOString(),
      },
    })
  })
  cronJobs.set(quest.id, job)
  updateQuest(quest.id, {
    scheduleConfig: {
      ...(quest.scheduleConfig ?? {}),
      nextRunAt: job.nextRun()?.toISOString(),
    },
  })
}

export function startScheduler(): void {
  for (const quest of listQuests({ kind: 'task', deleted: false })) {
    refreshQuestSchedule(quest)
  }
}

export function removeScheduledQuest(id: string): void {
  stopJob(id)
}

export function stopScheduler(): void {
  for (const id of [...cronJobs.keys()]) {
    stopJob(id)
  }
}
