export type CheckInCreatedBy = 'human' | 'ai' | 'system'
export type CheckInPriority = 'urgent' | 'high' | 'normal' | 'low'
export type CheckInListOrder = 'attention' | 'time'

export interface CheckIn {
  id: string
  projectId: string
  createdBy: CheckInCreatedBy
  originQuestId?: string
  originRunId?: string
  title: string
  body?: string
  remindAt?: string
  priority: CheckInPriority
  createdAt: string
  updatedAt: string
}

export interface CreateCheckInInput {
  projectId: string
  createdBy?: CheckInCreatedBy
  originQuestId?: string | null
  originRunId?: string | null
  title: string
  body?: string
  remindAt?: string
  priority?: CheckInPriority
}

export interface UpdateCheckInInput {
  originQuestId?: string | null
  originRunId?: string | null
  title?: string
  body?: string | null
  remindAt?: string | null
  priority?: CheckInPriority
}

export interface CompleteCheckInInput {
  createdBy?: CheckInCreatedBy
  note?: string | null
}

export interface CheckInRecord {
  id: string
  projectId: string
  checkInId: string
  originQuestId?: string
  originRunId?: string
  title: string
  body?: string
  remindAt?: string
  checkedAt: string
  createdBy: CheckInCreatedBy
  note?: string
  createdAt: string
  updatedAt: string
}
