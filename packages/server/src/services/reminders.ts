import type {
  CreateReminderInput,
  Reminder,
  ReminderListOrder,
  ReminderPriority,
  ReminderType,
  UpdateReminderInput,
} from '@pluse/types'
import { createProjectActivity } from '../models/project-activity'
import { createReminder, deleteReminder, getReminder, listReminders, updateReminder } from '../models/reminder'
import { listReminderProjectPriorities, setReminderProjectPriority } from '../modules/reminders/project-priorities'
import { sortRemindersForAttention } from '../modules/reminders/ranking'
import { emit } from './events'

export type ReminderListFilter = {
  projectId?: string
  type?: ReminderType
  originQuestId?: string
  originRunId?: string
  priority?: ReminderPriority
  time?: 'all' | 'due' | 'future'
  order?: ReminderListOrder
}

function emitReminderUpdated(reminder: Reminder): void {
  emit({
    type: 'reminder_updated',
    data: {
      reminderId: reminder.id,
      projectId: reminder.projectId,
      originQuestId: reminder.originQuestId,
    },
  })
}

function reminderActivityTitle(reminder: Reminder): string {
  return reminder.title.trim() || reminder.id
}

export function listReminderViews(filter: ReminderListFilter = {}): Reminder[] {
  const { order = 'attention', ...modelFilter } = filter
  const reminders = listReminders(modelFilter)
  if (order === 'time') return reminders
  return sortRemindersForAttention(reminders, listReminderProjectPriorities())
}

export { listReminderProjectPriorities }

export function setReminderProjectPriorityWithEffects(
  projectId: string,
  priority: Parameters<typeof setReminderProjectPriority>[1],
): ReturnType<typeof setReminderProjectPriority> {
  const result = setReminderProjectPriority(projectId, priority)
  emit({
    type: 'reminder_project_priority_updated',
    data: { projectId },
  })
  emit({ type: 'project_updated', data: { projectId } })
  return result
}

export function createReminderWithEffects(input: CreateReminderInput): Reminder {
  const reminder = createReminder(input)
  createProjectActivity({
    projectId: reminder.projectId,
    subjectType: 'reminder',
    subjectId: reminder.id,
    questId: reminder.originQuestId,
    title: reminderActivityTitle(reminder),
    op: 'created',
    actor: input.createdBy ?? 'human',
  })
  emitReminderUpdated(reminder)
  return reminder
}

export function findOpenReviewReminderForQuest(projectId: string, questId: string): Reminder | null {
  return listReminders({
    projectId,
    originQuestId: questId,
    type: 'review',
  })[0] ?? null
}

export function ensureReviewReminderWithEffects(input: CreateReminderInput): Reminder {
  if (!input.originQuestId || (input.type ?? 'custom') !== 'review') {
    return createReminderWithEffects(input)
  }

  const existing = findOpenReviewReminderForQuest(input.projectId, input.originQuestId)
  if (!existing) return createReminderWithEffects(input)

  const patch: UpdateReminderInput = {
    title: input.title,
    body: input.body ?? null,
    originRunId: input.originRunId ?? null,
    remindAt: input.remindAt ?? null,
  }
  if (input.priority !== undefined) patch.priority = input.priority
  return updateReminderWithEffects(existing.id, patch)
}

export function updateReminderWithEffects(id: string, input: UpdateReminderInput): Reminder {
  if (!getReminder(id)) throw new Error(`Reminder not found: ${id}`)
  const reminder = updateReminder(id, input)
  emitReminderUpdated(reminder)
  return reminder
}

export function deleteReminderWithEffects(id: string): void {
  const reminder = getReminder(id)
  if (!reminder) throw new Error(`Reminder not found: ${id}`)
  if (!deleteReminder(id)) throw new Error(`Reminder not found: ${id}`)
  emit({
    type: 'reminder_deleted',
    data: {
      reminderId: id,
      projectId: reminder.projectId,
      originQuestId: reminder.originQuestId,
    },
  })
}
