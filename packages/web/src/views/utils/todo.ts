import type { Todo, TodoRepeat } from '@pluse/types'

function toDate(value?: string): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatTodoRepeat(repeat: TodoRepeat, t?: (key: string) => string): string {
  if (repeat === 'daily') return t ? t('每天') : '每天'
  if (repeat === 'weekly') return t ? t('每周') : '每周'
  if (repeat === 'monthly') return t ? t('每月') : '每月'
  return t ? t('不重复') : '不重复'
}

export function formatTodoDueAt(value?: string, locale = 'zh-CN', t?: (key: string) => string): string {
  const parsed = toDate(value)
  if (!parsed) return t ? t('未设置') : '未设置'
  return new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

export function formatTodoScheduleSummary(
  todo: Pick<Todo, 'dueAt' | 'repeat'>,
  locale = 'zh-CN',
  t?: (key: string) => string,
): string | null {
  const parts: string[] = []
  if (todo.dueAt) parts.push(`${t ? t('截止') : '截止'} ${formatTodoDueAt(todo.dueAt, locale, t)}`)
  if (todo.repeat && todo.repeat !== 'none') parts.push(formatTodoRepeat(todo.repeat, t))
  return parts.length > 0 ? parts.join(' · ') : null
}

export function toDateTimeLocalValue(value?: string): string {
  const parsed = toDate(value)
  if (!parsed) return ''
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

export function fromDateTimeLocalValue(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}
