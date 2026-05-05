import type {
  CheckIn,
  CheckInListOrder,
  CheckInPriority,
  CheckInRecord,
  CompleteCheckInInput,
  CreateCheckInInput,
  UpdateCheckInInput,
} from '@pluse/types'
import { getDb } from '../db'
import {
  createCheckIn,
  createCheckInRecord,
  deleteCheckIn,
  getCheckIn,
  listCheckInRecords,
  listCheckIns,
  updateCheckIn,
} from '../models/check-in'
import { createProjectActivity } from '../models/project-activity'
import { emit } from './events'

export type CheckInListFilter = {
  projectId?: string
  originQuestId?: string
  originRunId?: string
  priority?: CheckInPriority
  time?: 'all' | 'due' | 'future'
  order?: CheckInListOrder
}

const CHECK_IN_PRIORITY_RANK: Record<CheckInPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
}

function attentionReadyRank(item: CheckIn): number {
  if (!item.remindAt) return 0
  return Date.parse(item.remindAt) <= Date.now() ? 0 : 1
}

function attentionTimeValue(item: CheckIn): number {
  return Date.parse(item.remindAt ?? item.updatedAt)
}

function compareCheckInsByAttention(left: CheckIn, right: CheckIn): number {
  const readyDelta = attentionReadyRank(left) - attentionReadyRank(right)
  if (readyDelta !== 0) return readyDelta

  const itemPriorityDelta = CHECK_IN_PRIORITY_RANK[left.priority] - CHECK_IN_PRIORITY_RANK[right.priority]
  if (itemPriorityDelta !== 0) return itemPriorityDelta

  const timeDelta = attentionTimeValue(left) - attentionTimeValue(right)
  if (timeDelta !== 0) return timeDelta
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
}

function emitCheckInUpdated(item: CheckIn): void {
  emit({
    type: 'check_in_updated',
    data: {
      checkInId: item.id,
      projectId: item.projectId,
      originQuestId: item.originQuestId,
    },
  })
}

function emitCheckInDeleted(item: CheckIn): void {
  emit({
    type: 'check_in_deleted',
    data: {
      checkInId: item.id,
      projectId: item.projectId,
      originQuestId: item.originQuestId,
    },
  })
}

function checkInActivityTitle(item: CheckIn): string {
  return item.title.trim() || item.id
}

export function listCheckInViews(filter: CheckInListFilter = {}): CheckIn[] {
  const { order = 'attention', ...modelFilter } = filter
  const items = listCheckIns(modelFilter)
  if (order === 'time') return items
  return [...items].sort(compareCheckInsByAttention)
}

export { getCheckIn, listCheckInRecords }

export function createCheckInWithEffects(input: CreateCheckInInput): CheckIn {
  const item = createCheckIn(input)
  createProjectActivity({
    projectId: item.projectId,
    subjectType: 'check_in',
    subjectId: item.id,
    questId: item.originQuestId,
    title: checkInActivityTitle(item),
    op: 'created',
    actor: input.createdBy ?? 'human',
  })
  emitCheckInUpdated(item)
  return item
}

export function updateCheckInWithEffects(id: string, input: UpdateCheckInInput): CheckIn {
  if (!getCheckIn(id)) throw new Error(`Check-in not found: ${id}`)
  const item = updateCheckIn(id, input)
  emitCheckInUpdated(item)
  return item
}

export function deleteCheckInWithEffects(id: string): void {
  const item = getCheckIn(id)
  if (!item) throw new Error(`Check-in not found: ${id}`)
  if (!deleteCheckIn(id)) throw new Error(`Check-in not found: ${id}`)
  emitCheckInDeleted(item)
}

export function completeCheckInWithEffects(
  id: string,
  input: CompleteCheckInInput = {},
): CheckInRecord {
  const db = getDb()
  const note = input.note?.trim() || null
  const createdBy = input.createdBy ?? 'human'

  const tx = db.transaction((): { item: CheckIn; record: CheckInRecord } => {
    const item = getCheckIn(id)
    if (!item) throw new Error(`Check-in not found: ${id}`)

    const record = createCheckInRecord({
      projectId: item.projectId,
      checkInId: item.id,
      originQuestId: item.originQuestId,
      originRunId: item.originRunId,
      title: item.title,
      body: item.body,
      remindAt: item.remindAt,
      createdBy,
      note,
    })

    if (!deleteCheckIn(id)) throw new Error(`Check-in not found: ${id}`)
    return { item, record }
  })

  const { item, record } = tx()

  createProjectActivity({
    projectId: item.projectId,
    subjectType: 'check_in',
    subjectId: item.id,
    questId: item.originQuestId,
    title: checkInActivityTitle(item),
    op: 'done',
    actor: createdBy,
  })
  emitCheckInDeleted(item)
  return record
}
