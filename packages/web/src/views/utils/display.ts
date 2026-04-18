import type { Quest } from '@pluse/types'

function normalizeText(value?: string | null): string {
  return value?.trim() ?? ''
}

export function displaySessionName(value?: string | null): string {
  const normalized = normalizeText(value)
  if (!normalized || normalized === 'Untitled Session') return '未命名会话'
  if (normalized === 'New Session') return '新会话'
  return normalized
}

export function displayTaskName(value?: string | null): string {
  const normalized = normalizeText(value)
  if (!normalized || normalized === 'Untitled Task') return '未命名任务'
  if (normalized === 'New Task') return '新任务'
  return normalized
}

export function displayQuestName(quest: Quest): string {
  return quest.kind === 'task'
    ? displayTaskName(quest.title || quest.name)
    : displaySessionName(quest.name || quest.title)
}
