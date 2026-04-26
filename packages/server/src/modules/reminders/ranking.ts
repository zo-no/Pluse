import type { Reminder, ReminderProjectPrioritySetting } from '@pluse/types'

const PROJECT_PRIORITY_RANK = {
  mainline: 0,
  priority: 1,
  normal: 2,
} as const

const REMINDER_PRIORITY_RANK = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
} as const

function reminderTimeRank(reminder: Reminder): number {
  if (!reminder.remindAt) return 0
  return Date.parse(reminder.remindAt) <= Date.now() ? 0 : 1
}

function reminderTimestamp(reminder: Reminder): number {
  return reminder.remindAt ? Date.parse(reminder.remindAt) : Number.POSITIVE_INFINITY
}

export function sortRemindersForAttention(
  reminders: Reminder[],
  projectPriorities: ReminderProjectPrioritySetting[],
): Reminder[] {
  const projectPriorityById = new Map(projectPriorities.map((setting) => [setting.projectId, setting.priority] as const))
  return [...reminders].sort((left, right) => {
    const dueDelta = reminderTimeRank(left) - reminderTimeRank(right)
    if (dueDelta !== 0) return dueDelta

    const projectDelta = PROJECT_PRIORITY_RANK[projectPriorityById.get(left.projectId) ?? 'normal']
      - PROJECT_PRIORITY_RANK[projectPriorityById.get(right.projectId) ?? 'normal']
    if (projectDelta !== 0) return projectDelta

    const priorityDelta = REMINDER_PRIORITY_RANK[left.priority] - REMINDER_PRIORITY_RANK[right.priority]
    if (priorityDelta !== 0) return priorityDelta

    const timeDelta = reminderTimestamp(left) - reminderTimestamp(right)
    if (timeDelta !== 0) return timeDelta

    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  })
}
