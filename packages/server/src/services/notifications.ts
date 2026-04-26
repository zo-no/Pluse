import type { CreateNotificationInput, Notification, UpdateNotificationInput } from '@pluse/types'
import {
  createNotification,
  getNotification,
  listNotifications,
  updateNotification,
} from '../models/notification'
import { emit } from './events'

function emitNotificationUpdated(notification: Notification): void {
  emit({
    type: 'notification_updated',
    data: {
      notificationId: notification.id,
      projectId: notification.projectId,
      originQuestId: notification.originQuestId,
    },
  })
}

export function listNotificationViews(filter: Parameters<typeof listNotifications>[0] = {}): Notification[] {
  return listNotifications(filter)
}

export function createNotificationWithEffects(input: CreateNotificationInput): Notification {
  const notification = createNotification(input)
  emitNotificationUpdated(notification)
  return notification
}

export function findUnreadReviewNotificationForQuest(projectId: string, questId: string): Notification | null {
  return listNotifications({
    projectId,
    originQuestId: questId,
    type: 'review',
    status: 'unread',
    deleted: false,
  })[0] ?? null
}

export function ensureReviewNotificationWithEffects(input: CreateNotificationInput): Notification {
  if (!input.originQuestId || input.type !== 'review') {
    return createNotificationWithEffects(input)
  }

  const existing = findUnreadReviewNotificationForQuest(input.projectId, input.originQuestId)
  if (existing) return existing
  return createNotificationWithEffects(input)
}

export function updateNotificationWithEffects(id: string, input: UpdateNotificationInput): Notification {
  const notification = updateNotification(id, input)
  emitNotificationUpdated(notification)
  return notification
}

export function deleteNotificationWithEffects(id: string): void {
  const notification = getNotification(id)
  if (!notification) throw new Error(`Notification not found: ${id}`)
  const updated = updateNotificationWithEffects(id, { deleted: true })
  emit({
    type: 'notification_deleted',
    data: {
      notificationId: id,
      projectId: updated.projectId,
      originQuestId: updated.originQuestId,
    },
  })
}
