import type { Todo, TodoRepeat } from '@pluse/types'

export type QuestPlanRowState = 'pending' | 'doing' | 'waiting' | 'done' | 'cancelled'

export interface QuestPlanRow {
  id: string
  questId: string
  createdBy: Todo['createdBy']
  state: QuestPlanRowState
  displayText: string
  helperText?: string
  order: number
  createdAt: string
  updatedAt: string
  source: Todo
}

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

function compareQuestPlanDate(left: string, right: string): number {
  const leftTs = Date.parse(left)
  const rightTs = Date.parse(right)
  if (!Number.isFinite(leftTs) && !Number.isFinite(rightTs)) return 0
  if (!Number.isFinite(leftTs)) return 1
  if (!Number.isFinite(rightTs)) return -1
  return leftTs - rightTs
}

export function compareQuestPlanItems(
  left: Pick<Todo, 'order' | 'createdAt' | 'id'>,
  right: Pick<Todo, 'order' | 'createdAt' | 'id'>,
): number {
  if (left.order !== right.order) return left.order - right.order
  const createdAtDelta = compareQuestPlanDate(left.createdAt, right.createdAt)
  if (createdAtDelta !== 0) return createdAtDelta
  return left.id.localeCompare(right.id)
}

export function sortQuestPlanItems(items: readonly Todo[]): Todo[] {
  return [...items].sort(compareQuestPlanItems)
}

export function projectQuestPlanRow(todo: Todo): QuestPlanRow {
  const waitingInstructions = todo.waitingInstructions?.trim()
  const isWaiting = Boolean(waitingInstructions) && todo.status !== 'done' && todo.status !== 'cancelled'
  const activeForm = todo.activeForm?.trim()

  return {
    id: todo.id,
    questId: todo.originQuestId ?? '',
    createdBy: todo.createdBy,
    state: isWaiting ? 'waiting' : todo.status,
    displayText: todo.status === 'doing' ? (activeForm || todo.title) : todo.title,
    helperText: isWaiting ? waitingInstructions : undefined,
    order: todo.order,
    createdAt: todo.createdAt,
    updatedAt: todo.updatedAt,
    source: todo,
  }
}

export function projectQuestPlanRows(items: readonly Todo[]): QuestPlanRow[] {
  return sortQuestPlanItems(items).map(projectQuestPlanRow)
}

export function summarizeQuestPlanRows(rows: readonly QuestPlanRow[]) {
  const summary = {
    total: rows.length,
    pending: 0,
    doing: 0,
    waiting: 0,
    done: 0,
    cancelled: 0,
  }

  for (const row of rows) {
    summary[row.state] += 1
  }

  return summary
}
