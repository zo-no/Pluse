export type ReminderCreatedBy = 'human' | 'ai' | 'system'
export type ReminderType = 'custom' | 'review' | 'follow_up' | 'needs_input' | 'failure'
export type ReminderPriority = 'urgent' | 'high' | 'normal' | 'low'
export type ReminderProjectPriority = 'mainline' | 'priority' | 'normal'
export type ReminderListOrder = 'attention' | 'time'

export interface ReminderProjectPrioritySetting {
  projectId: string
  priority: ReminderProjectPriority
  createdAt?: string
  updatedAt?: string
}

export interface SetReminderProjectPriorityInput {
  priority: ReminderProjectPriority
}

export interface SetReminderProjectPriorityResult {
  setting: ReminderProjectPrioritySetting
  settings: ReminderProjectPrioritySetting[]
}

export interface Reminder {
  id: string
  projectId: string
  createdBy: ReminderCreatedBy
  originQuestId?: string
  originRunId?: string
  type: ReminderType
  title: string
  body?: string
  remindAt?: string
  priority: ReminderPriority
  createdAt: string
  updatedAt: string
}

export interface CreateReminderInput {
  projectId: string
  createdBy?: ReminderCreatedBy
  originQuestId?: string | null
  originRunId?: string | null
  type?: ReminderType
  title: string
  body?: string
  remindAt?: string
  priority?: ReminderPriority
}

export interface UpdateReminderInput {
  originQuestId?: string | null
  originRunId?: string | null
  type?: ReminderType
  title?: string
  body?: string | null
  remindAt?: string | null
  priority?: ReminderPriority
}
