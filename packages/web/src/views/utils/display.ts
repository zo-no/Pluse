import type { Quest } from '@pluse/types'

type Translate = (key: string) => string

function normalizeText(value?: string | null): string {
  return value?.trim() ?? ''
}

export function displaySessionName(value?: string | null, t?: Translate): string {
  const normalized = normalizeText(value)
  if (!normalized || normalized === 'Untitled Session') return t ? t('未命名会话') : '未命名会话'
  if (normalized === 'New Session') return t ? t('新会话') : '新会话'
  return normalized
}

export function displayTaskName(value?: string | null, t?: Translate): string {
  const normalized = normalizeText(value)
  if (!normalized || normalized === 'Untitled Task' || normalized === '未命名任务') {
    return t ? t('未命名自动化') : '未命名自动化'
  }
  if (normalized === 'New Task' || normalized === '新任务') return t ? t('新自动化') : '新自动化'
  return normalized
}

export function displayQuestName(quest: Quest, t?: Translate): string {
  return quest.kind === 'task'
    ? displayTaskName(quest.title || quest.name, t)
    : displaySessionName(quest.name || quest.title, t)
}
