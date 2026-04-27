import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import type {
  Project,
  ProjectOverview,
  Quest,
  Reminder,
  ReminderProjectPriority,
  ReminderProjectPrioritySetting,
  Todo,
  UpdateTodoInput,
} from '@pluse/types'
import * as api from '@/api/client'
import { useI18n } from '@/i18n'
import { useSseEvent } from '@/views/hooks/useSseEvent'
import { formatTodoDueAt, formatTodoRepeat, fromDateTimeLocalValue, toDateTimeLocalValue } from '@/views/utils/todo'
import { ArchiveIcon, CheckIcon, ClockIcon, CloseIcon, PlusIcon, RouteIcon, SparkIcon } from './icons'
import { TaskComposerModal } from './TaskComposerModal'

interface TodoPanelProps {
  projectId: string | null
  projectName?: string | null
  projects: Project[]
  activeQuestId?: string | null
  onRequestClose?: () => void
  onDataChanged?: () => Promise<void> | void
}

type SourceTab = 'human' | 'reminder'
type SnoozePreset = 'later' | 'tomorrow' | 'next_week'
type WorkbenchTimelineKind = 'reminder' | 'todo' | 'automation'

type WorkbenchTimelineEntry = {
  id: string
  kind: WorkbenchTimelineKind
  title: string
  timeLabel: string
  sortTime: number
  href?: string
  reminderId?: string
  todoId?: string
}

type ProjectRailGroup = {
  key: string
  label: string
  reminderPriority: ReminderProjectPriority
  openTodos: Todo[]
  reminders: Reminder[]
}

function formatDateTime(value?: string, locale = 'zh-CN', t?: (key: string) => string): string {
  if (!value) return t ? t('未记录') : '未记录'
  return new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatSidebarTime(value?: string, t?: (key: string, values?: Record<string, string | number>) => string): string {
  if (!value) return ''
  const timestamp = new Date(value).getTime()
  const delta = Math.max(0, Date.now() - timestamp)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day
  if (delta < minute) return t ? t('刚刚') : '刚刚'
  if (delta < hour) return t ? t('{count} 分钟', { count: Math.max(1, Math.floor(delta / minute)) }) : `${Math.max(1, Math.floor(delta / minute))} 分钟`
  if (delta < day) return t ? t('{count} 小时', { count: Math.max(1, Math.floor(delta / hour)) }) : `${Math.max(1, Math.floor(delta / hour))} 小时`
  if (delta < week) return t ? t('{count} 天', { count: Math.max(1, Math.floor(delta / day)) }) : `${Math.max(1, Math.floor(delta / day))} 天`
  return t ? t('{count} 周', { count: Math.max(1, Math.floor(delta / week)) }) : `${Math.max(1, Math.floor(delta / week))} 周`
}

function formatClock(value: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

function formatTimelineTime(value: string | undefined, locale: string, t: (key: string) => string): string {
  if (!value) return t('现在')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return t('未记录')
  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const tomorrowStart = new Date(todayStart)
  tomorrowStart.setDate(todayStart.getDate() + 1)
  const dayAfterTomorrowStart = new Date(todayStart)
  dayAfterTomorrowStart.setDate(todayStart.getDate() + 2)
  if (date.getTime() < todayStart.getTime()) return t('逾期')
  if (date.getTime() < tomorrowStart.getTime()) return formatClock(date, locale)
  if (date.getTime() < dayAfterTomorrowStart.getTime()) return `${t('明天')} ${formatClock(date, locale)}`
  return new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function snoozeDate(preset: SnoozePreset): string {
  const next = new Date()
  if (preset === 'later') {
    next.setHours(next.getHours() + 2)
  } else if (preset === 'tomorrow') {
    next.setDate(next.getDate() + 1)
    next.setHours(9, 0, 0, 0)
  } else {
    next.setDate(next.getDate() + ((1 - next.getDay() + 7) % 7 || 7))
    next.setHours(9, 0, 0, 0)
  }
  return next.toISOString()
}

function defaultCustomSnoozeValue(): string {
  const next = new Date()
  next.setDate(next.getDate() + 1)
  next.setHours(9, 0, 0, 0)
  return toDateTimeLocalValue(next.toISOString())
}

function todoStatusLabel(status: Todo['status'], t?: (key: string) => string): string {
  if (status === 'done') return t ? t('已完成') : '已完成'
  if (status === 'cancelled') return t ? t('已取消') : '已取消'
  return t ? t('待处理') : '待处理'
}

const REMINDER_PROJECT_PRIORITY_RANK: Record<ReminderProjectPriority, number> = {
  mainline: 0,
  priority: 1,
  normal: 2,
  low: 3,
}

const REMINDER_PRIORITY_RANK: Record<Reminder['priority'], number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
}

function reminderReadyRank(reminder: Reminder): number {
  if (!reminder.remindAt) return 0
  return Date.parse(reminder.remindAt) <= Date.now() ? 0 : 1
}

function reminderTimeValue(reminder: Reminder): number {
  return reminder.remindAt ? Date.parse(reminder.remindAt) : Number.POSITIVE_INFINITY
}

function compareRemindersByAttention(left: Reminder, right: Reminder): number {
  const readyDelta = reminderReadyRank(left) - reminderReadyRank(right)
  if (readyDelta !== 0) return readyDelta
  const priorityDelta = REMINDER_PRIORITY_RANK[left.priority] - REMINDER_PRIORITY_RANK[right.priority]
  if (priorityDelta !== 0) return priorityDelta
  const timeDelta = reminderTimeValue(left) - reminderTimeValue(right)
  if (timeDelta !== 0) return timeDelta
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
}

function sortByUpdatedAt<T extends { updatedAt: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
}

function sortOpenTodos(items: Todo[]): Todo[] {
  return [...items].sort((left, right) => {
    const leftDue = left.dueAt ? Date.parse(left.dueAt) : Number.POSITIVE_INFINITY
    const rightDue = right.dueAt ? Date.parse(right.dueAt) : Number.POSITIVE_INFINITY
    if (leftDue !== rightDue) return leftDue - rightDue
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  })
}

function sortReminders(items: Reminder[]): Reminder[] {
  return [...items].sort(compareRemindersByAttention)
}

function automationNextRunAt(quest: Quest): string | undefined {
  if (quest.scheduleConfig?.nextRunAt) return quest.scheduleConfig.nextRunAt
  if (
    quest.scheduleKind === 'scheduled'
    && quest.status !== 'done'
    && quest.status !== 'cancelled'
  ) {
    return quest.scheduleConfig?.runAt
  }
  return undefined
}

function buildWorkbenchTimeline(params: {
  projectId: string | null
  todos: Todo[]
  reminders: Reminder[]
  automations: Quest[]
  locale: string
  t: (key: string) => string
}): WorkbenchTimelineEntry[] {
  if (!params.projectId) return []
  const now = Date.now()
  const horizon = now + 24 * 60 * 60 * 1000
  const entries: WorkbenchTimelineEntry[] = []
  const attentionReminderEntries: WorkbenchTimelineEntry[] = []

  for (const reminder of params.reminders) {
    if (reminder.projectId !== params.projectId) continue
    if (!reminder.remindAt) {
      attentionReminderEntries.push({
        id: `reminder-${reminder.id}`,
        kind: 'reminder',
        title: reminder.title,
        timeLabel: formatTimelineTime(undefined, params.locale, params.t),
        sortTime: now,
        reminderId: reminder.id,
      })
      continue
    }

    const time = Date.parse(reminder.remindAt)
    if (!Number.isFinite(time) || time > horizon) continue
    if (time <= now) {
      attentionReminderEntries.push({
        id: `reminder-${reminder.id}`,
        kind: 'reminder',
        title: reminder.title,
        timeLabel: formatTimelineTime(reminder.remindAt, params.locale, params.t),
        sortTime: time,
        reminderId: reminder.id,
      })
      continue
    }
    entries.push({
      id: `reminder-${reminder.id}`,
      kind: 'reminder',
      title: reminder.title,
      timeLabel: formatTimelineTime(reminder.remindAt, params.locale, params.t),
      sortTime: time,
      reminderId: reminder.id,
    })
  }

  for (const todo of params.todos) {
    if (todo.projectId !== params.projectId || todo.status !== 'pending' || !todo.dueAt) continue
    const time = Date.parse(todo.dueAt)
    if (!Number.isFinite(time) || time > horizon) continue
    entries.push({
      id: `todo-${todo.id}`,
      kind: 'todo',
      title: todo.title,
      timeLabel: formatTimelineTime(todo.dueAt, params.locale, params.t),
      sortTime: time,
      todoId: todo.id,
    })
  }

  for (const quest of params.automations) {
    if (quest.deleted || quest.enabled === false) continue
    const nextRunAt = automationNextRunAt(quest)
    if (!nextRunAt) continue
    const time = Date.parse(nextRunAt)
    if (!Number.isFinite(time) || time > horizon) continue
    entries.push({
      id: `automation-${quest.id}`,
      kind: 'automation',
      title: quest.title || quest.name || params.t('未命名自动化'),
      timeLabel: formatTimelineTime(nextRunAt, params.locale, params.t),
      sortTime: time,
      href: `/quests/${quest.id}`,
    })
  }

  return [
    ...attentionReminderEntries
      .sort((left, right) => right.sortTime - left.sortTime)
      .slice(0, 2),
    ...entries,
  ]
    .sort((left, right) => left.sortTime - right.sortTime)
    .slice(0, 6)
}

function timelineKindLabel(kind: WorkbenchTimelineKind, t: (key: string) => string): string {
  if (kind === 'automation') return t('自动化')
  if (kind === 'reminder') return t('提醒')
  return t('待办')
}

function formatEmptyMessage(
  source: SourceTab,
  t?: (key: string) => string,
): string {
  if (source === 'reminder') return t ? t('当前范围暂无提醒。') : '当前范围暂无提醒。'
  return t ? t('当前范围暂无待办。') : '当前范围暂无待办。'
}

function buildProjectRailGroups(params: {
  projects: Project[]
  activeProjectId: string | null
  activeProjectName?: string | null
  openTodos: Todo[]
  reminders: Reminder[]
  source: SourceTab
  reminderProjectPriorities?: Map<string, ReminderProjectPriority>
  t: (key: string) => string
}): ProjectRailGroup[] {
  const projectMap = new Map(params.projects.map((project) => [project.id, project] as const))
  const keys = new Set<string>()
  for (const project of params.projects) keys.add(project.id)
  for (const todo of params.openTodos) keys.add(todo.projectId)
  for (const reminder of params.reminders) keys.add(reminder.projectId)
  if (params.activeProjectId) keys.add(params.activeProjectId)

  return Array.from(keys)
    .map((key) => {
      const project = projectMap.get(key)
      return {
        key,
        label: project?.name ?? (key === params.activeProjectId && params.activeProjectName ? params.activeProjectName : `${params.t('项目')} ${key}`),
        reminderPriority: project?.priority ?? params.reminderProjectPriorities?.get(key) ?? 'normal',
        openTodos: params.openTodos.filter((todo) => todo.projectId === key),
        reminders: params.reminders.filter((reminder) => reminder.projectId === key),
      }
    })
    .filter((group) => {
      const hasItems = group.openTodos.length > 0 || group.reminders.length > 0
      return hasItems || group.key === params.activeProjectId
    })
    .sort((left, right) => {
      if (left.key === params.activeProjectId) return -1
      if (right.key === params.activeProjectId) return 1
      if (params.source === 'reminder') {
        const priorityDelta = REMINDER_PROJECT_PRIORITY_RANK[left.reminderPriority] - REMINDER_PROJECT_PRIORITY_RANK[right.reminderPriority]
        if (priorityDelta !== 0) return priorityDelta
        if (left.reminders[0] && right.reminders[0]) {
          const reminderDelta = compareRemindersByAttention(left.reminders[0], right.reminders[0])
          if (reminderDelta !== 0) return reminderDelta
        }
      }
      return left.label.localeCompare(right.label, 'zh-Hans-CN')
    })
}

const TodoRailItem = memo(function TodoRailItem({
  todo,
  archived,
  activeQuestId,
  locale,
  t,
  onOpenTodo,
  onToggleTodoStatus,
  onArchiveTodo,
  onOpenTodoSource,
  onRequestClose,
}: {
  todo: Todo
  archived: boolean
  activeQuestId?: string | null
  locale: string
  t: (key: string, values?: Record<string, string | number>) => string
  onOpenTodo: (todoId: string) => void
  onToggleTodoStatus: (todo: Todo, nextStatus: Todo['status']) => void
  onArchiveTodo: (todo: Todo, archived: boolean) => void
  onOpenTodoSource: () => void
  onRequestClose?: () => void
}) {
  const hasSource = Boolean(todo.originQuestId)
  const isActive = hasSource && todo.originQuestId === activeQuestId
  const isDone = todo.status === 'done'
  const isRecurring = todo.repeat !== 'none'
  const canToggle = !archived && todo.status !== 'cancelled'
  const visibleTags = todo.tags.slice(0, 3)
  const extraTagCount = Math.max(0, todo.tags.length - visibleTags.length)

  return (
    <article
      className={`pluse-sidebar-item pluse-sidebar-row pluse-task-list-item is-todo${isActive ? ' is-active' : ''}${archived ? ' is-archived' : ''}${isDone ? ' is-done' : ''}`}
    >
      <button
        type="button"
        className={`pluse-todo-toggle${isDone ? ' is-done' : ''}`}
        onClick={() => onToggleTodoStatus(todo, isDone ? 'pending' : 'done')}
        aria-label={isDone ? t('恢复任务') : isRecurring ? t('完成本次') : t('完成任务')}
        title={isDone ? t('恢复任务') : isRecurring ? t('完成本次') : t('完成任务')}
        disabled={!canToggle}
      >
        {isDone ? <CheckIcon className="pluse-icon" /> : null}
      </button>
      <button
        type="button"
        className="pluse-task-list-main pluse-sidebar-item-main-button pluse-task-list-detail-trigger"
        onClick={() => onOpenTodo(todo.id)}
        aria-label={`${t('待办详情')} · ${todo.title}`}
      >
        <div className="pluse-task-list-copy">
          <div className="pluse-sidebar-item-title">
            {todo.priority !== 'normal' ? <span className={`pluse-todo-priority-dot is-${todo.priority}`} aria-label={todo.priority} /> : null}
            <strong>{todo.title}</strong>
          </div>
          <div className="pluse-task-list-meta" title={formatDateTime(todo.updatedAt, locale, t)}>
            <span className={`pluse-task-list-state is-${todo.status}`}>{todoStatusLabel(todo.status, t)}</span>
            <span className="pluse-task-list-dot" aria-hidden="true">·</span>
            <span className="pluse-meta-inline">
              <ClockIcon className="pluse-icon pluse-inline-icon" />
              {formatSidebarTime(todo.updatedAt, t)}
            </span>
          </div>
          {visibleTags.length > 0 ? (
            <div className="pluse-todo-tags" aria-label={t('标签')}>
              {visibleTags.map((tag) => (
                <span key={tag} className="pluse-todo-tag">
                  {tag}
                </span>
              ))}
              {extraTagCount > 0 ? (
                <span className="pluse-todo-tag pluse-todo-tag-more">
                  +{extraTagCount}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </button>
      <div className="pluse-sidebar-item-actions">
        {todo.originQuestId ? (
          <Link
            className={`pluse-sidebar-action-btn pluse-task-source-link${isActive ? ' is-active' : ''}`}
            to={`/quests/${todo.originQuestId}`}
            onClick={() => {
              onOpenTodoSource()
              onRequestClose?.()
            }}
            aria-label={t('来源会话')}
            title={t('来源会话')}
          >
            <RouteIcon className="pluse-icon" />
          </Link>
        ) : null}
        {archived ? (
          <button
            type="button"
            className="pluse-sidebar-action-btn"
            onClick={() => onArchiveTodo(todo, false)}
            aria-label={t('恢复任务')}
            title={t('恢复任务')}
          >
            <ArchiveIcon className="pluse-icon" />
          </button>
        ) : (
          <button
            type="button"
            className="pluse-sidebar-action-btn"
            onClick={() => onArchiveTodo(todo, true)}
            aria-label={t('归档任务')}
            title={t('归档任务')}
          >
            <ArchiveIcon className="pluse-icon" />
          </button>
        )}
      </div>
    </article>
  )
})

const ReminderRailItem = memo(function ReminderRailItem({
  reminder,
  activeQuestId,
  locale,
  t,
  snoozeMenuOpen,
  snoozing,
  highlighted,
  onDeleteReminder,
  onOpenSnoozeMenu,
  onSnoozeReminder,
  onCustomSnoozeReminder,
  onRequestClose,
}: {
  reminder: Reminder
  activeQuestId?: string | null
  locale: string
  t: (key: string, values?: Record<string, string | number>) => string
  snoozeMenuOpen: boolean
  snoozing: boolean
  highlighted: boolean
  onDeleteReminder: (reminder: Reminder) => void
  onOpenSnoozeMenu: (reminderId: string) => void
  onSnoozeReminder: (reminder: Reminder, preset: SnoozePreset) => void
  onCustomSnoozeReminder: (reminder: Reminder) => void
  onRequestClose?: () => void
}) {
  const hasSource = Boolean(reminder.originQuestId)
  const isActive = hasSource && reminder.originQuestId === activeQuestId
  const timeValue = reminder.remindAt ?? reminder.updatedAt
  const timeLabel = reminder.remindAt
    ? `${t('提醒')} ${formatDateTime(reminder.remindAt, locale, t)}`
    : formatSidebarTime(reminder.updatedAt, t)

  const copy = (
    <div className="pluse-task-list-copy">
      <div className="pluse-sidebar-item-title">
        {reminder.priority !== 'normal' ? <span className={`pluse-todo-priority-dot is-${reminder.priority}`} aria-label={reminder.priority} /> : null}
        <strong>{reminder.title}</strong>
      </div>
      <div className="pluse-task-list-meta" title={formatDateTime(timeValue, locale, t)}>
        <span className="pluse-meta-inline">
          <ClockIcon className="pluse-icon pluse-inline-icon" />
          {timeLabel}
        </span>
      </div>
      {reminder.body ? <p className="pluse-task-list-note">{reminder.body}</p> : null}
    </div>
  )

  return (
    <article
      className={`pluse-sidebar-item pluse-sidebar-row pluse-task-list-item is-reminder${isActive ? ' is-active' : ''}${highlighted ? ' is-highlighted' : ''}`}
      data-reminder-id={reminder.id}
    >
      {reminder.originQuestId ? (
        <Link
          className="pluse-sidebar-item-main pluse-task-list-main"
          to={`/quests/${reminder.originQuestId}`}
          onClick={() => onRequestClose?.()}
          aria-label={`${t('来源会话')} · ${reminder.title}`}
        >
          {copy}
        </Link>
      ) : (
        <div className="pluse-sidebar-item-main pluse-task-list-main">
          {copy}
        </div>
      )}
      <div className="pluse-sidebar-item-actions">
        <button
          type="button"
          className="pluse-sidebar-action-btn"
          onClick={() => onOpenSnoozeMenu(reminder.id)}
          aria-label={t('延后提醒')}
          title={t('延后提醒')}
          disabled={snoozing}
        >
          <ClockIcon className="pluse-icon" />
        </button>
        <button
          type="button"
          className="pluse-sidebar-action-btn"
          onClick={() => onDeleteReminder(reminder)}
          aria-label={t('完成提醒')}
          title={t('完成提醒')}
          disabled={snoozing}
        >
          <CheckIcon className="pluse-icon" />
        </button>
      </div>
      {snoozeMenuOpen ? (
        <div className="pluse-reminder-snooze-menu" aria-label={t('延后提醒')}>
          <button type="button" onClick={() => onSnoozeReminder(reminder, 'later')} disabled={snoozing}>
            {t('稍后')}
          </button>
          <button type="button" onClick={() => onSnoozeReminder(reminder, 'tomorrow')} disabled={snoozing}>
            {t('明早')}
          </button>
          <button type="button" onClick={() => onSnoozeReminder(reminder, 'next_week')} disabled={snoozing}>
            {t('下周')}
          </button>
          <button type="button" onClick={() => onCustomSnoozeReminder(reminder)} disabled={snoozing}>
            {t('指定')}
          </button>
        </div>
      ) : null}
    </article>
  )
})

export function TodoPanel({
  projectId,
  projectName,
  projects,
  activeQuestId,
  onRequestClose,
  onDataChanged,
}: TodoPanelProps) {
  const { locale, t } = useI18n()
  const [globalTodos, setGlobalTodos] = useState<Todo[]>([])
  const [globalArchivedTodos, setGlobalArchivedTodos] = useState<Todo[]>([])
  const [globalReminders, setGlobalReminders] = useState<Reminder[]>([])
  const [projectOverview, setProjectOverview] = useState<ProjectOverview | null>(null)
  const [reminderProjectPriorities, setReminderProjectPriorities] = useState<ReminderProjectPrioritySetting[]>([])
  const [sourceTab, setSourceTab] = useState<SourceTab>('human')
  const [expandedProjectGroupKey, setExpandedProjectGroupKey] = useState<string | null>(projectId)
  const [collapsedReminderProjectKeys, setCollapsedReminderProjectKeys] = useState<string[]>([])
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createReminderOpen, setCreateReminderOpen] = useState(false)
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null)
  const [todoEditOpen, setTodoEditOpen] = useState(false)
  const [todoDraft, setTodoDraft] = useState({
    title: '',
    waitingInstructions: '',
    description: '',
    dueAt: '',
    repeat: 'none' as Todo['repeat'],
    priority: 'normal' as Todo['priority'],
    tags: [] as string[],
    tagInput: '',
  })
  const [reminderDraft, setReminderDraft] = useState({
    title: '',
    body: '',
    remindAt: '',
    priority: 'normal' as Reminder['priority'],
  })
  const [todoSaving, setTodoSaving] = useState(false)
  const [reminderSaving, setReminderSaving] = useState(false)
  const [snoozeMenuReminderId, setSnoozeMenuReminderId] = useState<string | null>(null)
  const [snoozingReminderId, setSnoozingReminderId] = useState<string | null>(null)
  const [customSnoozeReminderId, setCustomSnoozeReminderId] = useState<string | null>(null)
  const [customSnoozeAt, setCustomSnoozeAt] = useState('')
  const [highlightedReminderId, setHighlightedReminderId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [filterTags, setFilterTags] = useState<string[]>([])
  const [projectTags, setProjectTags] = useState<string[]>([])
  const reloadTimerRef = useRef<number | null>(null)
  const highlightedReminderTimerRef = useRef<number | null>(null)
  const pendingDataReloadRef = useRef(false)
  const dataRequestSeqRef = useRef(0)

  const loadData = useCallback(async () => {
    const requestId = dataRequestSeqRef.current + 1
    dataRequestSeqRef.current = requestId
    const [
      [
        globalTodoResult,
        globalArchivedTodoResult,
        globalReminderResult,
        reminderProjectPriorityResult,
      ],
      projectResults,
    ] = await Promise.all([
      Promise.all([
        api.getTodos({ deleted: false }),
        api.getTodos({ deleted: true }),
        api.getReminders({ order: 'attention' }),
        api.getReminderProjectPriorities(),
      ]),
      projectId
        ? Promise.all([
            api.getProjectTags(projectId),
            api.getProjectOverview(projectId),
          ])
        : Promise.resolve(null),
    ])
    if (requestId !== dataRequestSeqRef.current) return

    if (!globalTodoResult.ok) {
      setError(globalTodoResult.error)
      return
    }
    if (!globalArchivedTodoResult.ok) {
      setError(globalArchivedTodoResult.error)
      return
    }
    if (!globalReminderResult.ok) {
      setError(globalReminderResult.error)
      return
    }
    if (!reminderProjectPriorityResult.ok) {
      setError(reminderProjectPriorityResult.error)
      return
    }

    setGlobalTodos(globalTodoResult.data)
    setGlobalArchivedTodos(globalArchivedTodoResult.data)
    setGlobalReminders(globalReminderResult.data)
    setReminderProjectPriorities(reminderProjectPriorityResult.data)

    if (!projectResults) {
      setProjectTags([])
      setProjectOverview(null)
      setError(null)
      return
    }

    const [tagsResult, overviewResult] = projectResults
    setError(null)
    setProjectTags(tagsResult.ok ? tagsResult.data.tags : [])
    setProjectOverview(overviewResult.ok ? overviewResult.data : null)
  }, [projectId])

  useEffect(() => {
    void loadData()
    return () => {
      dataRequestSeqRef.current += 1
    }
  }, [loadData, projectId, reloadTick])

  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) {
        window.clearTimeout(reloadTimerRef.current)
        reloadTimerRef.current = null
      }
      if (highlightedReminderTimerRef.current) {
        window.clearTimeout(highlightedReminderTimerRef.current)
        highlightedReminderTimerRef.current = null
      }
      pendingDataReloadRef.current = false
    }
  }, [])

  useEffect(() => {
    pendingDataReloadRef.current = false
    if (reloadTimerRef.current) {
      window.clearTimeout(reloadTimerRef.current)
      reloadTimerRef.current = null
    }
    setSnoozeMenuReminderId(null)
    setSnoozingReminderId(null)
    setCustomSnoozeReminderId(null)
    setCustomSnoozeAt('')
    setHighlightedReminderId(null)
    if (highlightedReminderTimerRef.current) {
      window.clearTimeout(highlightedReminderTimerRef.current)
      highlightedReminderTimerRef.current = null
    }
  }, [projectId])

  useEffect(() => {
    setFilterTags((current) => current.filter((tag) =>
      projectTags.some((projectTag) => projectTag.toLowerCase() === tag.toLowerCase())
    ))
  }, [projectTags])

  useEffect(() => {
    setExpandedProjectGroupKey(projectId)
  }, [projectId, sourceTab])

  useSseEvent(
    (event) => {
      const shouldReloadData = event.type === 'reminder_project_priority_updated' || (
        event.type === 'todo_updated'
        || event.type === 'todo_deleted'
        || event.type === 'reminder_updated'
        || event.type === 'reminder_deleted'
        || event.type === 'quest_updated'
        || event.type === 'quest_deleted'
        || event.type === 'run_updated'
      )
      if (!shouldReloadData) return

      if (shouldReloadData) pendingDataReloadRef.current = true
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current)
      reloadTimerRef.current = window.setTimeout(() => {
        const nextDataReload = pendingDataReloadRef.current
        pendingDataReloadRef.current = false

        if (nextDataReload) setReloadTick((value) => value + 1)
      }, 300)
    },
    {
      onReconnect: () => {
        pendingDataReloadRef.current = false
        if (reloadTimerRef.current) {
          window.clearTimeout(reloadTimerRef.current)
          reloadTimerRef.current = null
        }
        void loadData()
      },
    },
  )

  const handleUpdateTodo = useCallback(async (todo: Todo, patch: UpdateTodoInput): Promise<boolean> => {
    const result = await api.updateTodo(todo.id, {
      title: patch.title,
      description: patch.description === undefined ? undefined : patch.description ?? null,
      waitingInstructions: patch.waitingInstructions === undefined ? undefined : patch.waitingInstructions ?? null,
      dueAt: patch.dueAt === undefined ? undefined : patch.dueAt ?? null,
      repeat: patch.repeat,
      originQuestId: patch.originQuestId === undefined ? undefined : patch.originQuestId ?? null,
      status: patch.status,
      priority: patch.priority,
      tags: patch.tags,
    })
    if (!result.ok) {
      setError(result.error)
      return false
    }
    await loadData()
    await onDataChanged?.()
    return true
  }, [loadData, onDataChanged])

  const handleArchiveTodo = useCallback(async (todo: Todo, deleted: boolean) => {
    const result = await api.updateTodo(todo.id, { deleted })
    if (!result.ok) {
      setError(result.error)
      return
    }
    await loadData()
    await onDataChanged?.()
  }, [loadData, onDataChanged])

  const handleDeleteReminder = useCallback(async (reminder: Reminder) => {
    const result = await api.deleteReminder(reminder.id)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await loadData()
    await onDataChanged?.()
  }, [loadData, onDataChanged])

  const handleSnoozeReminder = useCallback(async (reminder: Reminder, remindAt: string) => {
    setSnoozingReminderId(reminder.id)
    const result = await api.updateReminder(reminder.id, { remindAt })
    setSnoozingReminderId(null)
    if (!result.ok) {
      setError(result.error)
      return false
    }
    setSnoozeMenuReminderId(null)
    await loadData()
    await onDataChanged?.()
    return true
  }, [loadData, onDataChanged])

  const handlePresetSnoozeReminder = useCallback((reminder: Reminder, preset: SnoozePreset) => {
    void handleSnoozeReminder(reminder, snoozeDate(preset))
  }, [handleSnoozeReminder])

  const handleOpenCustomSnooze = useCallback((reminder: Reminder) => {
    setCustomSnoozeReminderId(reminder.id)
    setCustomSnoozeAt(toDateTimeLocalValue(reminder.remindAt) || defaultCustomSnoozeValue())
    setSnoozeMenuReminderId(null)
  }, [])

  async function handleSaveCustomSnooze() {
    if (!selectedCustomSnoozeReminder) return
    const remindAt = fromDateTimeLocalValue(customSnoozeAt)
    if (!remindAt) {
      setError(t('请选择提醒时间'))
      return
    }
    const ok = await handleSnoozeReminder(selectedCustomSnoozeReminder, remindAt)
    if (ok) {
      setCustomSnoozeReminderId(null)
      setCustomSnoozeAt('')
    }
  }

  function closeCustomSnooze() {
    if (snoozingReminderId) return
    setCustomSnoozeReminderId(null)
    setCustomSnoozeAt('')
  }

  const handleReminderProjectPriorityChange = useCallback(async (
    projectId: string,
    priority: ReminderProjectPriority,
  ) => {
    const result = await api.setReminderProjectPriority(projectId, { priority })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setReminderProjectPriorities(result.data.settings)
    await loadData()
    await onDataChanged?.()
  }, [loadData, onDataChanged])

  const visibleTodos = useMemo(() => {
    const base = globalTodos
    if (filterTags.length === 0) return base
    return base.filter((todo) =>
      filterTags.some((ft) => todo.tags.some((tag) => tag.toLowerCase() === ft.toLowerCase()))
    )
  }, [filterTags, globalTodos])

  const visibleReminders = useMemo(() => {
    if (sourceTab !== 'reminder') return []
    return globalReminders
  }, [globalReminders, sourceTab])

  const visibleArchivedTodos = useMemo(
    () => sourceTab === 'human' ? globalArchivedTodos : [],
    [globalArchivedTodos, sourceTab],
  )
  const hasActiveTagFilter = sourceTab === 'human' && filterTags.length > 0

  const humanCount = useMemo(
    () => globalTodos.filter((todo) => todo.status === 'pending').length,
    [globalTodos],
  )

  const reminderCount = useMemo(
    () => globalReminders.length,
    [globalReminders],
  )

  const openHumanTodos = useMemo(
    () => sortOpenTodos(visibleTodos.filter((todo) => todo.status === 'pending')),
    [visibleTodos],
  )

  const sortedReminders = useMemo(
    () => sortReminders(visibleReminders),
    [visibleReminders],
  )

  const reminderProjectPriorityMap = useMemo(
    () => new Map(reminderProjectPriorities.map((setting) => [setting.projectId, setting.priority] as const)),
    [reminderProjectPriorities],
  )

  const projectRailGroups = useMemo(
    () => buildProjectRailGroups({
      projects,
      activeProjectId: sourceTab === 'reminder' ? null : projectId,
      activeProjectName: sourceTab === 'reminder' ? null : projectName,
      openTodos: sourceTab === 'human' ? openHumanTodos : [],
      reminders: sourceTab === 'reminder' ? sortedReminders : [],
      source: sourceTab,
      reminderProjectPriorities: reminderProjectPriorityMap,
      t,
    }),
    [openHumanTodos, projectId, projectName, projects, reminderProjectPriorityMap, sortedReminders, sourceTab, t],
  )

  const visibleArchivedTodosSorted = useMemo(
    () => hasActiveTagFilter ? [] : sortByUpdatedAt(visibleArchivedTodos),
    [hasActiveTagFilter, visibleArchivedTodos],
  )

  const allKnownTodos = useMemo(() => {
    const deduped = new Map<string, Todo>()
    for (const item of [...globalTodos, ...globalArchivedTodos]) {
      deduped.set(item.id, item)
    }
    return Array.from(deduped.values())
  }, [globalTodos, globalArchivedTodos])
  const selectedTodo = useMemo(
    () => (selectedTodoId ? allKnownTodos.find((todo) => todo.id === selectedTodoId) ?? null : null),
    [allKnownTodos, selectedTodoId],
  )
  const selectedCustomSnoozeReminder = useMemo(
    () => (customSnoozeReminderId ? globalReminders.find((reminder) => reminder.id === customSnoozeReminderId) ?? null : null),
    [customSnoozeReminderId, globalReminders],
  )
  const workbenchTimeline = useMemo(
    () => buildWorkbenchTimeline({
      projectId,
      todos: globalTodos,
      reminders: globalReminders,
      automations: projectOverview?.tasks ?? [],
      locale,
      t,
    }),
    [globalReminders, globalTodos, locale, projectId, projectOverview?.tasks, t],
  )
  const modalRoot = typeof document !== 'undefined' ? document.body : null

  const hasVisibleContent = (
    openHumanTodos.length > 0
    || sortedReminders.length > 0
  )

  useEffect(() => {
    if (!selectedTodo) {
      setTodoEditOpen(false)
      setTodoDraft({
        title: '',
        waitingInstructions: '',
        description: '',
        dueAt: '',
        repeat: 'none',
        priority: 'normal',
        tags: [],
        tagInput: '',
      })
      return
    }
    setTodoDraft({
      title: selectedTodo.title,
      waitingInstructions: selectedTodo.waitingInstructions ?? '',
      description: selectedTodo.description ?? '',
      dueAt: toDateTimeLocalValue(selectedTodo.dueAt),
      repeat: selectedTodo.repeat,
      priority: selectedTodo.priority,
      tags: selectedTodo.tags,
      tagInput: '',
    })
    setTodoEditOpen(false)
  }, [selectedTodoId, selectedTodo?.updatedAt])

  useEffect(() => {
    if (!selectedTodoId) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedTodoId(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedTodoId])

  function openCreateModal() {
    setCreateModalOpen(true)
  }

  async function handleSaveSelectedTodo() {
    if (!selectedTodo) return
    const nextTitle = todoDraft.title.trim()
    if (!nextTitle) {
      setError(t('任务标题不能为空'))
      return
    }
    setTodoSaving(true)
    const ok = await handleUpdateTodo(selectedTodo, {
      title: nextTitle,
      waitingInstructions: todoDraft.waitingInstructions.trim() || null,
      description: todoDraft.description.trim() || null,
      dueAt: todoDraft.dueAt.trim() ? fromDateTimeLocalValue(todoDraft.dueAt) ?? null : null,
      repeat: todoDraft.repeat,
      priority: todoDraft.priority,
      tags: todoDraft.tags,
    })
    setTodoSaving(false)
    if (ok) setTodoEditOpen(false)
  }

  async function handleCreateReminder() {
    if (!projectId) return
    const nextTitle = reminderDraft.title.trim()
    if (!nextTitle) {
      setError(t('提醒标题不能为空'))
      return
    }
    setReminderSaving(true)
    const result = await api.createReminder({
      projectId,
      createdBy: 'human',
      originQuestId: activeQuestId || undefined,
      title: nextTitle,
      body: reminderDraft.body.trim() || undefined,
      remindAt: reminderDraft.remindAt.trim() ? fromDateTimeLocalValue(reminderDraft.remindAt) ?? undefined : undefined,
      priority: reminderDraft.priority,
    })
    setReminderSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setReminderDraft({
      title: '',
      body: '',
      remindAt: '',
      priority: 'normal',
    })
    setCreateReminderOpen(false)
    await loadData()
    await onDataChanged?.()
  }

  function closeCreateReminder() {
    if (reminderSaving) return
    setCreateReminderOpen(false)
    setReminderDraft({
      title: '',
      body: '',
      remindAt: '',
      priority: 'normal',
    })
  }

  const handleOpenTodo = useCallback((todoId: string) => {
    setSelectedTodoId(todoId)
  }, [])

  const handleToggleTodoStatus = useCallback((todo: Todo, nextStatus: Todo['status']) => {
    void handleUpdateTodo(todo, { status: nextStatus })
  }, [handleUpdateTodo])

  const handleOpenTodoSource = useCallback(() => {
    setSelectedTodoId(null)
  }, [])

  const handleOpenTimelineReminder = useCallback((reminderId: string) => {
    const reminder = globalReminders.find((item) => item.id === reminderId)
    setSourceTab('reminder')
    if (reminder?.projectId) {
      setCollapsedReminderProjectKeys((current) => current.filter((key) => key !== reminder.projectId))
    }
    setHighlightedReminderId(reminderId)
    if (highlightedReminderTimerRef.current) {
      window.clearTimeout(highlightedReminderTimerRef.current)
      highlightedReminderTimerRef.current = null
    }
    window.setTimeout(() => {
      const element = document.querySelector<HTMLElement>(`[data-reminder-id="${reminderId}"]`)
      element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      highlightedReminderTimerRef.current = window.setTimeout(() => {
        setHighlightedReminderId((current) => current === reminderId ? null : current)
        highlightedReminderTimerRef.current = null
      }, 2400)
    }, 80)
  }, [globalReminders])

  const handleOpenAutomationPanel = useCallback(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches) {
      onRequestClose?.()
    }
  }, [onRequestClose])

  return (
    <>
      <aside className="pluse-rail">
        <div className="pluse-mobile-panel-header">
          <button type="button" className="pluse-icon-button" onClick={onRequestClose} aria-label={t('关闭工作台')} title={t('关闭工作台')}>
            <CloseIcon className="pluse-icon" />
          </button>
        </div>

        <div className="pluse-rail-head pluse-rail-head-sidebar">
          <div className="pluse-sidebar-project-context pluse-workbench-project-context">
            <div className="pluse-workbench-project-strip">
              <div className="pluse-workbench-project-copy">
                <span>{t('工作台')}</span>
                <strong>{projectName || t('当前项目')}</strong>
              </div>
              {projectId ? (
                <Link
                  className="pluse-workbench-project-action"
                  to={`/projects/${projectId}#automation`}
                  onClick={handleOpenAutomationPanel}
                  aria-label={t('进入自动化面板')}
                  title={t('进入自动化面板')}
                >
                  <SparkIcon className="pluse-icon" />
                  <span>{t('自动化')}</span>
                </Link>
              ) : (
                <button
                  type="button"
                  className="pluse-workbench-project-action"
                  disabled
                  aria-label={t('进入自动化面板')}
                  title={t('进入自动化面板')}
                >
                  <SparkIcon className="pluse-icon" />
                  <span>{t('自动化')}</span>
                </button>
              )}
            </div>
          </div>
          <div className="pluse-sidebar-tabs pluse-rail-object-tabs" role="tablist" aria-label={t('对象类型')}>
            <button
              type="button"
              className={`pluse-sidebar-tab pluse-rail-object-tab${sourceTab === 'human' ? ' is-active' : ''}`}
              onClick={() => setSourceTab('human')}
              aria-selected={sourceTab === 'human'}
            >
              {t('待办')}
              {humanCount > 0 ? <span className="pluse-tab-count">{humanCount}</span> : null}
            </button>
            <button
              type="button"
              className={`pluse-sidebar-tab pluse-rail-object-tab${sourceTab === 'reminder' ? ' is-active' : ''}`}
              onClick={() => setSourceTab('reminder')}
              aria-selected={sourceTab === 'reminder'}
            >
              {t('提醒')}
              {reminderCount > 0 ? <span className="pluse-tab-count">{reminderCount}</span> : null}
            </button>
          </div>
        </div>

        {projectId ? (
          <section className="pluse-workbench-timeline" aria-label={t('接下来 24 小时')}>
            <header className="pluse-workbench-timeline-head">
              <span>{t('接下来 24 小时')}</span>
              <strong>{workbenchTimeline.length > 0 ? t('{{count}} 项', { count: workbenchTimeline.length }) : t('暂无时间事项')}</strong>
            </header>
            {workbenchTimeline.length > 0 ? (
              <div className="pluse-workbench-timeline-list">
                {workbenchTimeline.map((entry) => {
                  const itemClassName = `pluse-workbench-timeline-item is-${entry.kind}`
                  const content = (
                    <>
                      <span className="pluse-workbench-timeline-time">{entry.timeLabel}</span>
                      <span className={`pluse-workbench-timeline-kind is-${entry.kind}`}>
                        {timelineKindLabel(entry.kind, t)}
                      </span>
                      <strong>{entry.title}</strong>
                    </>
                  )
                  if (entry.href) {
                    return (
                      <Link
                        key={entry.id}
                        className={itemClassName}
                        to={entry.href}
                        onClick={() => onRequestClose?.()}
                      >
                        {content}
                      </Link>
                    )
                  }
                  if (entry.reminderId) {
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        className={itemClassName}
                        onClick={() => handleOpenTimelineReminder(entry.reminderId ?? '')}
                        aria-label={`${t('定位提醒')} · ${entry.title}`}
                      >
                        {content}
                      </button>
                    )
                  }
                  if (entry.todoId) {
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        className={itemClassName}
                        onClick={() => setSelectedTodoId(entry.todoId ?? null)}
                      >
                        {content}
                      </button>
                    )
                  }
                  return (
                    <div key={entry.id} className={itemClassName}>
                      {content}
                    </div>
                  )
                })}
              </div>
            ) : null}
          </section>
        ) : null}

        {sourceTab === 'human' && projectTags.length > 0 ? (
          <div className="pluse-sidebar-search pluse-todo-tag-filter-row">
            {projectTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`pluse-todo-tag-chip${filterTags.includes(tag) ? ' is-active' : ''}`}
                onClick={() => setFilterTags((current) =>
                  current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]
                )}
              >
                {tag}
              </button>
            ))}
          </div>
        ) : null}

        <div className="pluse-task-list">
          {projectRailGroups.map((group) => {
            const reminderCollapsed = sourceTab === 'reminder' && collapsedReminderProjectKeys.includes(group.key)
            const reminderDefaultCollapsed = sourceTab === 'reminder' && group.reminderPriority === 'low'
            const expanded = sourceTab === 'reminder'
              ? reminderDefaultCollapsed ? reminderCollapsed : !reminderCollapsed
              : expandedProjectGroupKey === group.key
            const groupCount = sourceTab === 'human'
              ? group.openTodos.length
              : group.reminders.length
            const hasGroupContent = groupCount > 0
            return (
            <section
              key={group.key}
              className="pluse-domain-group pluse-task-project-group"
            >
              <div className="pluse-domain-group-head">
                <button
                  type="button"
                  className="pluse-domain-group-toggle"
                  onClick={() => {
                    if (sourceTab === 'reminder') {
                      setCollapsedReminderProjectKeys((current) =>
                        current.includes(group.key)
                          ? current.filter((key) => key !== group.key)
                          : [...current, group.key]
                      )
                    } else {
                      setExpandedProjectGroupKey((current) => current === group.key ? null : group.key)
                    }
                  }}
                >
                  <span className="pluse-domain-group-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                  <div className="pluse-domain-group-copy">
                    <strong>{group.label}</strong>
                    <span>{groupCount}</span>
                  </div>
                </button>
                {sourceTab === 'reminder' ? (
                  <select
                    className={`pluse-reminder-project-priority-select is-${group.reminderPriority}`}
                    value={group.reminderPriority}
                    aria-label={t('项目提醒优先级')}
                    title={t('项目提醒优先级')}
                    onChange={(event) => void handleReminderProjectPriorityChange(
                      group.key,
                      event.currentTarget.value as ReminderProjectPriority,
                    )}
                  >
                    <option value="mainline">{t('主线')}</option>
                    <option value="priority">{t('优先')}</option>
                    <option value="normal">{t('普通')}</option>
                    <option value="low">{t('低优先')}</option>
                  </select>
                ) : null}
              </div>
              {expanded ? (
                <div className="pluse-task-project-folder">
                  {sourceTab === 'human' && group.openTodos.length > 0 ? (
                    <div className="pluse-task-folder-section">
                      <div className="pluse-note-list">
                        {group.openTodos.map((todo) => (
                          <TodoRailItem
                            key={todo.id}
                            todo={todo}
                            archived={false}
                            activeQuestId={activeQuestId}
                            locale={locale}
                            t={t}
                            onOpenTodo={handleOpenTodo}
                            onToggleTodoStatus={handleToggleTodoStatus}
                            onArchiveTodo={handleArchiveTodo}
                            onOpenTodoSource={handleOpenTodoSource}
                            onRequestClose={onRequestClose}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {sourceTab === 'reminder' && group.reminders.length > 0 ? (
                    <div className="pluse-task-folder-section">
                      <div className="pluse-note-list">
                        {group.reminders.map((reminder) => (
                          <ReminderRailItem
                            key={reminder.id}
                            reminder={reminder}
                            activeQuestId={activeQuestId}
                            locale={locale}
                            t={t}
                            snoozeMenuOpen={snoozeMenuReminderId === reminder.id}
                            snoozing={snoozingReminderId === reminder.id}
                            highlighted={highlightedReminderId === reminder.id}
                            onDeleteReminder={handleDeleteReminder}
                            onOpenSnoozeMenu={(reminderId) => setSnoozeMenuReminderId((current) => current === reminderId ? null : reminderId)}
                            onSnoozeReminder={handlePresetSnoozeReminder}
                            onCustomSnoozeReminder={handleOpenCustomSnooze}
                            onRequestClose={onRequestClose}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {!hasGroupContent ? (
                    <div className="pluse-rail-empty pluse-task-empty-state">
                      <strong>{t('暂无任务')}</strong>
                      <p>{formatEmptyMessage(sourceTab, t)}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
            )
          })}

          {!hasVisibleContent && projectRailGroups.length === 0 ? (
            <div className="pluse-rail-empty pluse-task-empty-state">
              <strong>{t('暂无任务')}</strong>
              <p>{formatEmptyMessage(sourceTab, t)}</p>
            </div>
          ) : null}

          {visibleArchivedTodosSorted.length > 0 ? (
            <section className="pluse-domain-group pluse-task-archive">
              <div className="pluse-domain-group-head">
                <button
                  type="button"
                  className="pluse-domain-group-toggle"
                  onClick={() => setArchivedExpanded((value) => !value)}
                >
                  <span className="pluse-domain-group-chevron" aria-hidden="true">{archivedExpanded ? '▾' : '▸'}</span>
                  <div className="pluse-domain-group-copy">
                    <strong>{t('归档')}</strong>
                    {archivedExpanded ? <span>{visibleArchivedTodosSorted.length}</span> : null}
                  </div>
                </button>
              </div>
              {archivedExpanded ? (
                <div className="pluse-note-list" style={{ marginTop: 8 }}>
                  {visibleArchivedTodosSorted.map((todo) => (
                    <TodoRailItem
                      key={todo.id}
                      todo={todo}
                      archived
                      activeQuestId={activeQuestId}
                      locale={locale}
                      t={t}
                      onOpenTodo={handleOpenTodo}
                      onToggleTodoStatus={handleToggleTodoStatus}
                      onArchiveTodo={handleArchiveTodo}
                      onOpenTodoSource={handleOpenTodoSource}
                      onRequestClose={onRequestClose}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>

        <section className="pluse-rail-section-new-task">
          <button
            type="button"
            className="pluse-sidebar-chip-link pluse-sidebar-new-session-card pluse-rail-new-task-card"
            onClick={() => {
              if (sourceTab === 'reminder') setCreateReminderOpen(true)
              else openCreateModal()
            }}
            aria-label={sourceTab === 'reminder' ? t('新建提醒') : t('新建待办')}
            disabled={!projectId}
          >
            <PlusIcon className="pluse-icon" />
            <span>{sourceTab === 'reminder' ? t('新建提醒') : t('新建待办')}</span>
          </button>
        </section>

        {error ? <p className="pluse-error" style={{ padding: '0 14px 14px' }}>{error}</p> : null}
      </aside>

      <TaskComposerModal
        open={createModalOpen}
        projectId={projectId}
        projectName={projectName}
        initialKind="human"
        showKindSwitch={false}
        onClose={() => setCreateModalOpen(false)}
        onCreated={async () => {
          await loadData()
          await onDataChanged?.()
        }}
      />

      {createReminderOpen && modalRoot ? createPortal(
        <div className="pluse-modal-backdrop pluse-todo-detail-backdrop" onClick={closeCreateReminder}>
          <section
            className="pluse-modal-panel pluse-todo-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reminder-create-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="pluse-todo-detail-head">
              <div className="pluse-todo-detail-identity">
                <span className="pluse-task-detail-kicker">{t('提醒')}</span>
                <div className="pluse-task-detail-title-row">
                  <h2 id="reminder-create-title">{t('新建提醒')}</h2>
                </div>
              </div>
              <button
                type="button"
                className="pluse-icon-button"
                onClick={closeCreateReminder}
                aria-label={t('关闭')}
                title={t('关闭')}
                disabled={reminderSaving}
              >
                <CloseIcon className="pluse-icon" />
              </button>
            </header>

            <div className="pluse-todo-detail-body">
              <div className="pluse-form-grid pluse-todo-detail-form">
                <label>
                  <span>{t('标题')}</span>
                  <input
                    value={reminderDraft.title}
                    onChange={(event) => setReminderDraft((current) => ({ ...current, title: event.target.value }))}
                    placeholder={t('输入提醒标题')}
                    maxLength={160}
                    autoFocus
                  />
                </label>
                <label>
                  <span>{t('时间')}</span>
                  <input
                    type="datetime-local"
                    value={reminderDraft.remindAt}
                    onChange={(event) => setReminderDraft((current) => ({ ...current, remindAt: event.target.value }))}
                  />
                </label>
                <div className="pluse-form-field">
                  <span>{t('优先级')}</span>
                  <div className="pluse-priority-selector">
                    {(['urgent', 'high', 'normal', 'low'] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={`pluse-priority-option is-${p}${reminderDraft.priority === p ? ' is-active' : ''}`}
                        onClick={() => setReminderDraft((current) => ({ ...current, priority: p }))}
                      >
                        {p === 'urgent' ? t('紧急') : p === 'high' ? t('高') : p === 'normal' ? t('普通') : t('低')}
                      </button>
                    ))}
                  </div>
                </div>
                <label>
                  <span>{t('内容')}</span>
                  <textarea
                    value={reminderDraft.body}
                    onChange={(event) => setReminderDraft((current) => ({ ...current, body: event.target.value }))}
                    placeholder={t('补充提醒内容')}
                    rows={5}
                  />
                </label>
              </div>
            </div>

            <footer className="pluse-todo-detail-actions">
              <button
                type="button"
                className="pluse-button"
                onClick={() => void handleCreateReminder()}
                disabled={reminderSaving || !reminderDraft.title.trim()}
              >
                {reminderSaving ? t('保存中…') : t('创建提醒')}
              </button>
              <button
                type="button"
                className="pluse-button pluse-button-ghost"
                onClick={closeCreateReminder}
                disabled={reminderSaving}
              >
                {t('取消')}
              </button>
            </footer>
          </section>
        </div>,
        modalRoot,
      ) : null}

      {selectedCustomSnoozeReminder && modalRoot ? createPortal(
        <div className="pluse-modal-backdrop pluse-todo-detail-backdrop" onClick={closeCustomSnooze}>
          <section
            className="pluse-modal-panel pluse-reminder-snooze-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reminder-snooze-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="pluse-todo-detail-head">
              <div className="pluse-todo-detail-identity">
                <span className="pluse-task-detail-kicker">{t('提醒')}</span>
                <div className="pluse-task-detail-title-row">
                  <h2 id="reminder-snooze-title">{t('指定提醒时间')}</h2>
                </div>
                <div className="pluse-task-detail-meta">
                  <span>{selectedCustomSnoozeReminder.title}</span>
                </div>
              </div>
              <button
                type="button"
                className="pluse-icon-button"
                onClick={closeCustomSnooze}
                aria-label={t('关闭')}
                title={t('关闭')}
                disabled={Boolean(snoozingReminderId)}
              >
                <CloseIcon className="pluse-icon" />
              </button>
            </header>

            <div className="pluse-todo-detail-body">
              <label className="pluse-todo-edit-title-field">
                <span>{t('时间')}</span>
                <input
                  type="datetime-local"
                  value={customSnoozeAt}
                  onChange={(event) => setCustomSnoozeAt(event.target.value)}
                  autoFocus
                />
              </label>
            </div>

            <footer className="pluse-todo-detail-actions">
              <button
                type="button"
                className="pluse-button"
                onClick={() => void handleSaveCustomSnooze()}
                disabled={Boolean(snoozingReminderId) || !customSnoozeAt}
              >
                {snoozingReminderId ? t('保存中…') : t('保存')}
              </button>
              <button
                type="button"
                className="pluse-button pluse-button-ghost"
                onClick={closeCustomSnooze}
                disabled={Boolean(snoozingReminderId)}
              >
                {t('取消')}
              </button>
            </footer>
          </section>
        </div>,
        modalRoot,
      ) : null}

      {selectedTodo && modalRoot ? createPortal(
        <div className="pluse-modal-backdrop pluse-todo-detail-backdrop" onClick={() => setSelectedTodoId(null)}>
          <section
            className="pluse-modal-panel pluse-todo-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`todo-detail-title-${selectedTodo.id}`}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="pluse-todo-detail-head">
              <div className="pluse-todo-detail-identity">
                <span className="pluse-task-detail-kicker">{t('待办')}</span>
                <div className="pluse-task-detail-title-row">
                  <h2 id={`todo-detail-title-${selectedTodo.id}`}>{selectedTodo.title}</h2>
                </div>
                <div className="pluse-task-detail-meta">
                  <span>{todoStatusLabel(selectedTodo.status, t)}</span>
                  <span>{formatDateTime(selectedTodo.updatedAt, locale, t)}</span>
                </div>
              </div>
              <button
                type="button"
                className="pluse-icon-button"
                onClick={() => setSelectedTodoId(null)}
                aria-label={t('关闭')}
                title={t('关闭')}
              >
                <CloseIcon className="pluse-icon" />
              </button>
            </header>

            <div className="pluse-todo-detail-body">
              {todoEditOpen ? (
                <div className="pluse-todo-edit-form">
                  <label className="pluse-todo-edit-title-field">
                    <span>{t('标题')}</span>
                    <input
                      value={todoDraft.title}
                      onChange={(event) => setTodoDraft((current) => ({ ...current, title: event.target.value }))}
                      placeholder={t('输入任务标题')}
                      maxLength={160}
                    />
                  </label>
                  <div className="pluse-todo-edit-properties">
                    <div className="pluse-todo-edit-property is-priority">
                      <span>{t('优先级')}</span>
                      <div className="pluse-priority-selector">
                        {(['urgent', 'high', 'normal', 'low'] as const).map((p) => (
                          <button
                            key={p}
                            type="button"
                            className={`pluse-priority-option is-${p}${todoDraft.priority === p ? ' is-active' : ''}`}
                            onClick={() => setTodoDraft((current) => ({ ...current, priority: p }))}
                          >
                            {p === 'urgent' ? t('紧急') : p === 'high' ? t('高') : p === 'normal' ? t('普通') : t('低')}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="pluse-todo-edit-property">
                      <span>{t('时间')}</span>
                      <input
                        type="datetime-local"
                        value={todoDraft.dueAt}
                        onChange={(event) => setTodoDraft((current) => ({ ...current, dueAt: event.target.value }))}
                      />
                    </label>
                    <label className="pluse-todo-edit-property">
                      <span>{t('重复')}</span>
                      <select
                        value={todoDraft.repeat}
                        onChange={(event) => setTodoDraft((current) => ({ ...current, repeat: event.target.value as Todo['repeat'] }))}
                      >
                        <option value="none">{formatTodoRepeat('none', t)}</option>
                        <option value="daily">{formatTodoRepeat('daily', t)}</option>
                        <option value="weekly">{formatTodoRepeat('weekly', t)}</option>
                        <option value="monthly">{formatTodoRepeat('monthly', t)}</option>
                      </select>
                    </label>
                  </div>
                  <div className="pluse-todo-edit-property is-tags">
                    <span>{t('标签')}</span>
                    <div className="pluse-tags-editor">
                      {todoDraft.tags.map((tag) => (
                        <span key={tag} className="pluse-todo-tag pluse-todo-tag-removable">
                          {tag}
                          <button
                            type="button"
                            className="pluse-todo-tag-remove"
                            onClick={() => setTodoDraft((current) => ({ ...current, tags: current.tags.filter((t) => t !== tag) }))}
                            aria-label={`${t('移除标签')} ${tag}`}
                          >×</button>
                        </span>
                      ))}
                      <input
                        className="pluse-tags-input"
                        value={todoDraft.tagInput}
                        onChange={(event) => setTodoDraft((current) => ({ ...current, tagInput: event.target.value }))}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ',') {
                            event.preventDefault()
                            const newTag = todoDraft.tagInput.trim().replace(/,+$/, '')
                            if (newTag && !todoDraft.tags.some((t) => t.toLowerCase() === newTag.toLowerCase())) {
                              setTodoDraft((current) => ({ ...current, tags: [...current.tags, newTag], tagInput: '' }))
                            } else {
                              setTodoDraft((current) => ({ ...current, tagInput: '' }))
                            }
                          } else if (event.key === 'Backspace' && !todoDraft.tagInput && todoDraft.tags.length > 0) {
                            setTodoDraft((current) => ({ ...current, tags: current.tags.slice(0, -1) }))
                          }
                        }}
                        placeholder={todoDraft.tags.length === 0 ? t('输入标签，回车确认') : ''}
                        list="pluse-project-tags-datalist"
                      />
                      <datalist id="pluse-project-tags-datalist">
                        {projectTags.filter((tag) => !todoDraft.tags.includes(tag)).map((tag) => (
                          <option key={tag} value={tag} />
                        ))}
                      </datalist>
                    </div>
                  </div>
                  <label className="pluse-todo-edit-text-field">
                    <span>{t('等待说明')}</span>
                    <textarea
                      value={todoDraft.waitingInstructions}
                      onChange={(event) => setTodoDraft((current) => ({ ...current, waitingInstructions: event.target.value }))}
                      placeholder={t('补充等待谁、等什么、满足什么条件后继续')}
                      rows={3}
                    />
                  </label>
                  <label className="pluse-todo-edit-text-field">
                    <span>{t('备注')}</span>
                    <textarea
                      value={todoDraft.description}
                      onChange={(event) => setTodoDraft((current) => ({ ...current, description: event.target.value }))}
                      placeholder={t('补充上下文、链接或补充说明')}
                      rows={3}
                    />
                  </label>
                </div>
              ) : (
                <>
                  {(selectedTodo.priority !== 'normal' || selectedTodo.tags.length > 0) ? (
                    <section className="pluse-todo-detail-section">
                      <div className="pluse-todo-detail-pills">
                        {selectedTodo.priority !== 'normal' ? (
                          <span className={`pluse-sidebar-badge pluse-priority-badge is-${selectedTodo.priority}`}>
                            {selectedTodo.priority === 'urgent' ? t('紧急') : selectedTodo.priority === 'high' ? t('高优先级') : t('低优先级')}
                          </span>
                        ) : null}
                        {selectedTodo.tags.map((tag) => (
                          <span key={tag} className="pluse-todo-tag">{tag}</span>
                        ))}
                      </div>
                    </section>
                  ) : null}
                  {(selectedTodo.dueAt || selectedTodo.repeat !== 'none') ? (
                    <section className="pluse-todo-detail-section">
                      <h3>{t('计划')}</h3>
                      <div className="pluse-todo-detail-pills">
                        {selectedTodo.dueAt ? <span className="pluse-sidebar-badge">{t('截止')} {formatTodoDueAt(selectedTodo.dueAt, locale, t)}</span> : null}
                        {selectedTodo.repeat !== 'none' ? <span className="pluse-sidebar-badge">{formatTodoRepeat(selectedTodo.repeat, t)}</span> : null}
                      </div>
                    </section>
                  ) : null}

                  {selectedTodo.waitingInstructions ? (
                    <section className="pluse-todo-detail-section">
                      <h3>{t('等待说明')}</h3>
                      <p>{selectedTodo.waitingInstructions}</p>
                    </section>
                  ) : null}

                  {selectedTodo.description ? (
                    <section className="pluse-todo-detail-section">
                      <h3>{t('说明')}</h3>
                      <p>{selectedTodo.description}</p>
                    </section>
                  ) : null}

                  {selectedTodo.originQuestId ? (
                    <section className="pluse-todo-detail-section">
                      <h3>{t('来源')}</h3>
                      <Link
                        className="pluse-sidebar-chip-link"
                        to={`/quests/${selectedTodo.originQuestId}`}
                        onClick={() => {
                          setSelectedTodoId(null)
                          onRequestClose?.()
                        }}
                      >
                        {t('来源会话')}
                      </Link>
                    </section>
                  ) : null}
                </>
              )}
            </div>

            <footer className="pluse-todo-detail-actions">
              {selectedTodo.deleted ? (
                <button
                  type="button"
                  className="pluse-button pluse-button-ghost"
                  onClick={() => void handleArchiveTodo(selectedTodo, false)}
                >
                  {t('恢复任务')}
                </button>
              ) : (
                <>
                  {todoEditOpen ? (
                    <>
                      <button
                        type="button"
                        className="pluse-button"
                        onClick={() => void handleSaveSelectedTodo()}
                        disabled={todoSaving || !todoDraft.title.trim()}
                      >
                        {todoSaving ? t('保存中…') : t('保存修改')}
                      </button>
                      <button
                        type="button"
                        className="pluse-button pluse-button-ghost"
                        onClick={() => {
                          setTodoDraft({
                            title: selectedTodo.title,
                            waitingInstructions: selectedTodo.waitingInstructions ?? '',
                            description: selectedTodo.description ?? '',
                            dueAt: toDateTimeLocalValue(selectedTodo.dueAt),
                            repeat: selectedTodo.repeat,
                            priority: selectedTodo.priority,
                            tags: selectedTodo.tags,
                            tagInput: '',
                          })
                          setTodoEditOpen(false)
                        }}
                        disabled={todoSaving}
                      >
                        {t('取消')}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="pluse-button pluse-button-ghost"
                      onClick={() => setTodoEditOpen(true)}
                    >
                      {t('编辑')}
                    </button>
                  )}
                  {selectedTodo.status === 'pending' ? (
                    <button
                      type="button"
                      className="pluse-button"
                      onClick={() => void handleUpdateTodo(selectedTodo, { status: 'done' })}
                      disabled={todoSaving}
                    >
                      {selectedTodo.repeat !== 'none' ? t('完成本次') : t('完成任务')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="pluse-button pluse-button-ghost"
                      onClick={() => void handleUpdateTodo(selectedTodo, { status: 'pending' })}
                      disabled={todoSaving}
                    >
                      {t('恢复任务')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="pluse-button pluse-button-ghost"
                    onClick={() => void handleArchiveTodo(selectedTodo, true)}
                    disabled={todoSaving}
                  >
                    {t('归档任务')}
                  </button>
                </>
              )}
            </footer>
          </section>
        </div>,
        modalRoot,
      ) : null}
    </>
  )
}
