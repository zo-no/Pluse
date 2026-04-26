export type NotificationType = 'review'
export type NotificationStatus = 'unread' | 'read'
export type NotificationCreatedBy = 'human' | 'ai' | 'system'

export interface Notification {
  id: string
  projectId: string
  createdBy: NotificationCreatedBy
  originQuestId?: string
  originRunId?: string
  type: NotificationType
  title: string
  body?: string
  status: NotificationStatus
  deleted?: boolean
  deletedAt?: string
  createdAt: string
  updatedAt: string
}

export interface CreateNotificationInput {
  projectId: string
  createdBy?: NotificationCreatedBy
  originQuestId?: string | null
  originRunId?: string | null
  type: NotificationType
  title: string
  body?: string
  status?: NotificationStatus
  deleted?: boolean
}

export interface UpdateNotificationInput {
  title?: string
  body?: string | null
  status?: NotificationStatus
  deleted?: boolean
}
