import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import type {
  CheckIn,
  Domain,
  Project,
  ProjectPriority,
  Quest,
  Todo,
  UpdateTodoInput,
} from '@pluse/types'
import * as api from '@/api/client'
import { useI18n } from '@/i18n'
import { useSseEvent } from '@/views/hooks/useSseEvent'
import { formatTodoDueAt, formatTodoRepeat, fromDateTimeLocalValue, toDateTimeLocalValue } from '@/views/utils/todo'
import { ProgressRailPanel } from './ProgressPanel'
import { AutomationRailPanel } from './AutomationRailPanel'
import { ArchiveIcon, CheckIcon, ClockIcon, CloseIcon, DelayIcon, DetailIcon, PlusIcon, RouteIcon, SparkIcon } from './icons'
import { TaskComposerModal, type TaskComposerKind } from './TaskComposerModal'

/**
 * scope 控制 TodoPanel 的作用域语义：
 * - 'global'（默认）：左侧栏全局视图，展示全部待办/提醒/打卡，按项目分组
 * - 'project'：右侧工作台项目上下文视图，聚焦于 projectId 对应项目
 *   （当前仅展示过滤后视图，未来可进一步裁剪 tabs 和数据拉取范围）
 */
export type TodoPanelScope = 'global' | 'project'

interface TodoPanelProps {
  projectId: string | null
  projectName?: string | null
  projects: Project[]
  activeQuestId?: string | null
  onRequestClose?: () => void
  onDataChanged?: () => Promise<void> | void
  onSelectProject?: (projectId: string) => void
  /** 嵌入左侧栏时为 true，不渲染外层 aside */
  embedded?: boolean
  /** 嵌入模式下，外部控制的初始 tab */
  initialTab?: 'human' | 'check_in' | 'automation' | 'progress'
  /**
   * 作用域：'global' 为全局视图（左侧栏默认），'project' 为项目上下文（右侧工作台用）
   * @default 'global'
   */
  scope?: TodoPanelScope
}

type SourceTab = 'progress' | 'human' | 'check_in' | 'automation'
type SnoozePreset = 'later' | 'tomorrow' | 'next_week'

type ProjectRailGroup = {
  key: string
  label: string
  openTodos: Todo[]
  checkIns: CheckIn[]
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

function formatDueTime(
  dueAt: string,
  locale: string,
  t: (key: string, values?: Record<string, string | number>) => string,
): { label: string; overdue: boolean } {
  const ts = new Date(dueAt).getTime()
  const now = Date.now()
  const diff = ts - now
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const overdue = diff < 0
  if (overdue) {
    const absDiff = Math.abs(diff)
    if (absDiff < hour) return { label: t('逾期 {count} 分钟', { count: Math.max(1, Math.floor(absDiff / minute)) }), overdue: true }
    if (absDiff < day) return { label: t('逾期 {count} 小时', { count: Math.max(1, Math.floor(absDiff / hour)) }), overdue: true }
    return { label: t('逾期 {count} 天', { count: Math.max(1, Math.floor(absDiff / day)) }), overdue: true }
  }
  if (diff < hour) return { label: t('{count} 分钟后截止', { count: Math.max(1, Math.floor(diff / minute)) }), overdue: false }
  if (diff < day) return { label: t('{count} 小时后截止', { count: Math.max(1, Math.floor(diff / hour)) }), overdue: false }
  if (diff < 7 * day) return { label: t('{count} 天后截止', { count: Math.max(1, Math.floor(diff / day)) }), overdue: false }
  return {
    label: new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }).format(new Date(dueAt)),
    overdue: false,
  }
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

function attentionPriorityLabel(priority: CheckIn['priority'], t?: (key: string) => string): string {
  if (priority === 'urgent') return t ? t('紧急') : '紧急'
  if (priority === 'high') return t ? t('高优先级') : '高优先级'
  if (priority === 'low') return t ? t('低优先级') : '低优先级'
  return t ? t('普通') : '普通'
}

function todoPriorityBadgeText(priority: Todo['priority'] | CheckIn['priority']): string {
  if (priority === 'urgent') return '!!'
  if (priority === 'high') return '!'
  if (priority === 'low') return '↓'
  return ''
}

function todoPriorityAriaLabel(priority: Todo['priority'] | CheckIn['priority'], t?: (key: string) => string): string {
  if (priority === 'urgent') return t ? t('紧急') : '紧急'
  if (priority === 'high') return t ? t('高优先级') : '高优先级'
  if (priority === 'low') return t ? t('低优先级') : '低优先级'
  return ''
}

const ATTENTION_PRIORITY_RANK: Record<CheckIn['priority'], number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
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

function compareCheckInsByAttention(left: CheckIn, right: CheckIn): number {
  const leftReady = left.remindAt ? (Date.parse(left.remindAt) <= Date.now() ? 0 : 1) : 0
  const rightReady = right.remindAt ? (Date.parse(right.remindAt) <= Date.now() ? 0 : 1) : 0
  if (leftReady !== rightReady) return leftReady - rightReady
  const priorityDelta = ATTENTION_PRIORITY_RANK[left.priority] - ATTENTION_PRIORITY_RANK[right.priority]
  if (priorityDelta !== 0) return priorityDelta
  const leftTime = Date.parse(left.remindAt ?? left.updatedAt)
  const rightTime = Date.parse(right.remindAt ?? right.updatedAt)
  if (leftTime !== rightTime) return leftTime - rightTime
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
}

function sortCheckIns(items: CheckIn[]): CheckIn[] {
  return [...items].sort(compareCheckInsByAttention)
}

function formatEmptyMessage(
  source: SourceTab,
  t?: (key: string) => string,
  scope?: TodoPanelScope,
): string {
  const isProject = scope === 'project'
  if (source === 'progress') return t ? t('当前会话尚无计划项。') : '当前会话尚无计划项。'
  if (source === 'check_in') return t ? (isProject ? t('该项目暂无打卡。') : t('当前暂无打卡。')) : (isProject ? '该项目暂无打卡。' : '当前暂无打卡。')
  if (source === 'automation') return t ? t('当前项目暂无自动化。') : '当前项目暂无自动化。'
  return t ? (isProject ? t('该项目暂无待办。') : t('当前暂无待办。')) : (isProject ? '该项目暂无待办。' : '当前暂无待办。')
}

function buildProjectRailGroups(params: {
  projects: Project[]
  activeProjectId: string | null
  activeProjectName?: string | null
  openTodos: Todo[]
  checkIns: CheckIn[]
  source: 'human' | 'check_in'
  t: (key: string) => string
}): ProjectRailGroup[] {
  const projectMap = new Map(params.projects.map((project) => [project.id, project] as const))
  const keys = new Set<string>()
  for (const project of params.projects) keys.add(project.id)
  for (const todo of params.openTodos) keys.add(todo.projectId)
  for (const item of params.checkIns) keys.add(item.projectId)
  if (params.activeProjectId) keys.add(params.activeProjectId)

  return Array.from(keys)
    .map((key) => {
      const project = projectMap.get(key)
      return {
        key,
        label: project?.name ?? (key === params.activeProjectId && params.activeProjectName ? params.activeProjectName : `${params.t('项目')} ${key}`),
        openTodos: params.openTodos.filter((todo) => todo.projectId === key),
        checkIns: params.checkIns.filter((item) => item.projectId === key),
      }
    })
    .filter((group) => {
      const hasItems = group.openTodos.length > 0 || group.checkIns.length > 0
      return hasItems || group.key === params.activeProjectId
    })
    .sort((left, right) => {
      if (left.key === params.activeProjectId) return -1
      if (right.key === params.activeProjectId) return 1
      if (params.source === 'check_in' && left.checkIns[0] && right.checkIns[0]) {
        const checkInDelta = compareCheckInsByAttention(left.checkIns[0], right.checkIns[0])
        if (checkInDelta !== 0) return checkInDelta
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
  const priorityClass = todo.priority !== 'normal' ? ` is-priority-${todo.priority}` : ''

  return (
    <article
      className={`pluse-sidebar-item pluse-sidebar-row pluse-task-list-item is-todo${priorityClass}${isActive ? ' is-active' : ''}${archived ? ' is-archived' : ''}${isDone ? ' is-done' : ''}`}
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
            {todo.priority !== 'normal' ? (
              <span
                className={`pluse-todo-priority-badge is-${todo.priority}`}
                aria-label={todoPriorityAriaLabel(todo.priority, t)}
                title={todoPriorityAriaLabel(todo.priority, t)}
              >
                {todoPriorityBadgeText(todo.priority)}
              </span>
            ) : null}
            <strong>{todo.title}</strong>
          </div>
          {todo.status === 'pending' ? (
            <div className="pluse-task-list-meta" title={todo.dueAt ? formatDateTime(todo.dueAt, locale, t) : formatDateTime(todo.updatedAt, locale, t)}>
              {todo.dueAt ? (() => {
                const due = formatDueTime(todo.dueAt, locale, t)
                return (
                  <span className={`pluse-meta-inline${due.overdue ? ' pluse-meta-overdue' : ''}`}>
                    <ClockIcon className="pluse-icon pluse-inline-icon" />
                    {due.label}
                  </span>
                )
              })() : (
                <span className="pluse-meta-inline">
                  <ClockIcon className="pluse-icon pluse-inline-icon" />
                  {formatSidebarTime(todo.updatedAt, t)}
                </span>
              )}
              {isRecurring ? (
                <>
                  <span className="pluse-task-list-dot" aria-hidden="true">·</span>
                  <span className="pluse-task-list-state">{t('重复')}</span>
                </>
              ) : null}
            </div>
          ) : (
            <div className="pluse-task-list-meta" title={formatDateTime(todo.updatedAt, locale, t)}>
              <span className={`pluse-task-list-state is-${todo.status}`}>{todoStatusLabel(todo.status, t)}</span>
              <span className="pluse-task-list-dot" aria-hidden="true">·</span>
              <span className="pluse-meta-inline">
                <ClockIcon className="pluse-icon pluse-inline-icon" />
                {formatSidebarTime(todo.updatedAt, t)}
              </span>
            </div>
          )}
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

const CheckInRailItem = memo(function CheckInRailItem({
  item,
  activeQuestId,
  locale,
  t,
  snoozeMenuOpen,
  busy,
  highlighted,
  onComplete,
  onOpenCheckIn,
  onOpenSnoozeMenu,
  onSnoozeCheckIn,
  onCustomSnoozeCheckIn,
  onRequestClose,
}: {
  item: CheckIn
  activeQuestId?: string | null
  locale: string
  t: (key: string, values?: Record<string, string | number>) => string
  snoozeMenuOpen: boolean
  busy: boolean
  highlighted: boolean
  onComplete: (item: CheckIn) => void
  onOpenCheckIn: (id: string) => void
  onOpenSnoozeMenu: (id: string) => void
  onSnoozeCheckIn: (item: CheckIn, preset: SnoozePreset) => void
  onCustomSnoozeCheckIn: (item: CheckIn) => void
  onRequestClose?: () => void
}) {
  const hasSource = Boolean(item.originQuestId)
  const isActive = hasSource && item.originQuestId === activeQuestId
  const timeValue = item.remindAt ?? item.updatedAt
  const timeLabel = item.remindAt
    ? `${t('提醒')} ${formatDateTime(item.remindAt, locale, t)}`
    : formatSidebarTime(item.updatedAt, t)
  const mainClassName = 'pluse-sidebar-item-main-button pluse-task-list-main pluse-task-list-detail-trigger'

  const copy = (
    <div className="pluse-task-list-copy">
      <div className="pluse-sidebar-item-title">
        {item.priority !== 'normal' ? (
          <span
            className={`pluse-todo-priority-badge is-${item.priority}`}
            aria-label={todoPriorityAriaLabel(item.priority, t)}
            title={todoPriorityAriaLabel(item.priority, t)}
          >
            {todoPriorityBadgeText(item.priority)}
          </span>
        ) : null}
        <strong>{item.title}</strong>
      </div>
      <div className="pluse-task-list-meta" title={formatDateTime(timeValue, locale, t)}>
        <span className="pluse-task-list-state is-check-in">{t('打卡')}</span>
        <span className="pluse-task-list-dot" aria-hidden="true">·</span>
        <span className="pluse-meta-inline">
          <ClockIcon className="pluse-icon pluse-inline-icon" />
          {timeLabel}
        </span>
      </div>
      {item.body ? <p className="pluse-task-list-note">{item.body}</p> : null}
    </div>
  )

  return (
    <article
      className={`pluse-sidebar-item pluse-sidebar-row pluse-task-list-item is-check-in${isActive ? ' is-active' : ''}${highlighted ? ' is-highlighted' : ''}`}
      data-check-in-id={item.id}
    >
      {item.originQuestId ? (
        <Link
          className={mainClassName}
          to={`/quests/${item.originQuestId}`}
          onClick={() => onRequestClose?.()}
          aria-label={`${t('来源会话')} · ${item.title}`}
        >
          {copy}
        </Link>
      ) : (
        <button
          type="button"
          className={mainClassName}
          onClick={() => onOpenCheckIn(item.id)}
          aria-label={`${t('打卡详情')} · ${item.title}`}
        >
          {copy}
        </button>
      )}
      <div className="pluse-sidebar-item-actions">
        {item.originQuestId ? (
          <button
            type="button"
            className={`pluse-sidebar-action-btn pluse-task-source-link${isActive ? ' is-active' : ''}`}
            onClick={() => onOpenCheckIn(item.id)}
            aria-label={t('打卡详情')}
            title={t('打卡详情')}
          >
            <DetailIcon className="pluse-icon" />
          </button>
        ) : null}
        <button
          type="button"
          className="pluse-sidebar-action-btn"
          onClick={() => onOpenSnoozeMenu(item.id)}
          aria-label={t('延后打卡')}
          title={t('延后打卡')}
          disabled={busy}
        >
          <DelayIcon className="pluse-icon" />
        </button>
        <button
          type="button"
          className="pluse-sidebar-action-btn"
          onClick={() => onComplete(item)}
          aria-label={t('完成打卡')}
          title={t('完成打卡')}
          disabled={busy}
        >
          <CheckIcon className="pluse-icon" />
        </button>
      </div>
      {snoozeMenuOpen ? (
        <div className="pluse-reminder-snooze-menu" aria-label={t('延后打卡')}>
          <button type="button" onClick={() => onSnoozeCheckIn(item, 'later')} disabled={busy}>
            {t('稍后')}
          </button>
          <button type="button" onClick={() => onSnoozeCheckIn(item, 'tomorrow')} disabled={busy}>
            {t('明早')}
          </button>
          <button type="button" onClick={() => onSnoozeCheckIn(item, 'next_week')} disabled={busy}>
            {t('下周')}
          </button>
          <button type="button" onClick={() => onCustomSnoozeCheckIn(item)} disabled={busy}>
            {t('指定')}
          </button>
        </div>
      ) : null}
    </article>
  )
})

const PROJECT_PRIORITY_ORDER: ProjectPriority[] = ['mainline', 'priority', 'normal', 'low']

function projectPriorityLabel(priority: ProjectPriority, t: (key: string) => string): string {
  if (priority === 'mainline') return t('主线')
  if (priority === 'priority') return t('优先')
  if (priority === 'low') return t('低优先')
  return t('普通')
}

function sortProjectsByPriorityGroup(projects: Project[]): Project[] {
  return [...projects].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  })
}

export function TodoPanel({
  projectId,
  projectName,
  projects,
  activeQuestId,
  onRequestClose,
  onDataChanged,
  onSelectProject,
  embedded,
  initialTab,
  scope = 'global',
}: TodoPanelProps) {
  const { locale, t } = useI18n()
  const navigate = useNavigate()
  const [globalTodos, setGlobalTodos] = useState<Todo[]>([])
  const [globalArchivedTodos, setGlobalArchivedTodos] = useState<Todo[]>([])
  const [globalCheckIns, setGlobalCheckIns] = useState<CheckIn[]>([])
  const [sourceTab, setSourceTab] = useState<SourceTab>(initialTab ?? (activeQuestId ? 'progress' : 'human'))

  // embedded 模式下由父组件通过 initialTab 控制当前 tab
  useEffect(() => {
    if (embedded && initialTab) setSourceTab(initialTab)
  }, [embedded, initialTab])
  const [expandedProjectGroupKeys, setExpandedProjectGroupKeys] = useState<string[]>(() => (projectId ? [projectId] : []))
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createModalKind, setCreateModalKind] = useState<TaskComposerKind>('human')
  const [createCheckInOpen, setCreateCheckInOpen] = useState(false)
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null)
  const [selectedCheckInId, setSelectedCheckInId] = useState<string | null>(null)
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
  const [checkInDraft, setCheckInDraft] = useState({
    title: '',
    body: '',
    remindAt: '',
    priority: 'normal' as CheckIn['priority'],
  })
  const [checkInNoteDraft, setCheckInNoteDraft] = useState('')
  const [todoSaving, setTodoSaving] = useState(false)
  const [checkInSaving, setCheckInSaving] = useState(false)
  const [snoozeMenuCheckInId, setSnoozeMenuCheckInId] = useState<string | null>(null)
  const [busyCheckInId, setBusyCheckInId] = useState<string | null>(null)
  const [customSnoozeCheckInId, setCustomSnoozeCheckInId] = useState<string | null>(null)
  const [customSnoozeAt, setCustomSnoozeAt] = useState('')
  const [highlightedCheckInId, setHighlightedCheckInId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [filterTags, setFilterTags] = useState<string[]>([])
  const [projectTags, setProjectTags] = useState<string[]>([])
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [domains, setDomains] = useState<Domain[]>([])
  const [expandedProjectPriorityGroups, setExpandedProjectPriorityGroups] = useState<Record<string, boolean>>({
    normal: false,
    low: false,
  })
  const reloadTimerRef = useRef<number | null>(null)
  const pendingDataReloadRef = useRef(false)
  const dataRequestSeqRef = useRef(0)

  const loadData = useCallback(async () => {
    const requestId = dataRequestSeqRef.current + 1
    dataRequestSeqRef.current = requestId
    // project scope：按当前项目过滤，只拉取与该项目相关的数据
    const todoProjectFilter = scope === 'project' && projectId ? projectId : undefined
    const contextProjectId = scope === 'project' ? projectId ?? undefined : undefined
    const [
      [
        globalTodoResult,
        globalArchivedTodoResult,
        globalCheckInResult,
      ],
      projectResults,
    ] = await Promise.all([
      Promise.all([
        api.getTodos({ deleted: false, projectId: todoProjectFilter }),
        api.getTodos({ deleted: true, projectId: todoProjectFilter }),
        api.getCheckIns({ order: 'attention', projectId: contextProjectId }),
      ]),
      projectId ? api.getProjectTags(projectId) : Promise.resolve(null),
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
    if (!globalCheckInResult.ok) {
      setError(globalCheckInResult.error)
      return
    }

    setGlobalTodos(globalTodoResult.data)
    setGlobalArchivedTodos(globalArchivedTodoResult.data)
    setGlobalCheckIns(globalCheckInResult.data)

    if (!projectResults) {
      setProjectTags([])
      setError(null)
      return
    }

    setError(null)
    setProjectTags(projectResults.ok ? projectResults.data.tags : [])
  }, [projectId, scope])

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
      pendingDataReloadRef.current = false
    }
  }, [])

  useEffect(() => {
    pendingDataReloadRef.current = false
    if (reloadTimerRef.current) {
      window.clearTimeout(reloadTimerRef.current)
      reloadTimerRef.current = null
    }
    setSnoozeMenuCheckInId(null)
    setBusyCheckInId(null)
    setCustomSnoozeCheckInId(null)
    setCustomSnoozeAt('')
    setHighlightedCheckInId(null)
    setSelectedCheckInId(null)
  }, [projectId])

  useEffect(() => {
    setFilterTags((current) => current.filter((tag) =>
      projectTags.some((projectTag) => projectTag.toLowerCase() === tag.toLowerCase())
    ))
  }, [projectTags])

  useEffect(() => {
    setExpandedProjectGroupKeys(projectId ? [projectId] : [])
  }, [projectId, sourceTab])

  useEffect(() => {
    if (!activeQuestId && sourceTab === 'progress') {
      setSourceTab(scope === 'project' ? 'automation' : 'human')
    }
  }, [activeQuestId, scope, sourceTab])

  useEffect(() => {
    if (scope === 'project' && (sourceTab === 'human' || sourceTab === 'check_in')) {
      setSourceTab(activeQuestId ? 'progress' : 'automation')
    }
  }, [activeQuestId, scope, sourceTab])

  useSseEvent(
    (event) => {
      const shouldReloadData = (
        event.type === 'todo_updated'
        || event.type === 'todo_deleted'
        || event.type === 'check_in_updated'
        || event.type === 'check_in_deleted'
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

  const activeProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projects, projectId],
  )

  const activeDomainName = useMemo(() => {
    if (!activeProject?.domainId) return t('未分组')
    return domains.find((d) => d.id === activeProject.domainId)?.name ?? t('未分组')
  }, [activeProject, domains, t])

  const activeProjectContextLabel = useMemo(() => (
    activeProject
      ? `${projectPriorityLabel(activeProject.priority, t)} · ${activeDomainName}`
      : activeDomainName
  ), [activeDomainName, activeProject, t])

  type ProjectPickerGroup = {
    key: string
    label: string
    priority: ProjectPriority
    projects: Project[]
  }

  const projectPickerGroups = useMemo<ProjectPickerGroup[]>(() => {
    return PROJECT_PRIORITY_ORDER
      .map((priority) => ({
        key: priority,
        label: projectPriorityLabel(priority, t),
        priority,
        projects: sortProjectsByPriorityGroup(projects.filter((project) => project.priority === priority)),
      }))
      .filter((group) => group.projects.length > 0)
  }, [projects, t])

  function projectDomainName(project: Project): string {
    if (!project.domainId) return t('未分组')
    return domains.find((domain) => domain.id === project.domainId)?.name ?? t('未分组')
  }

  function openProject(newProjectId: string) {
    onSelectProject?.(newProjectId)
    setProjectPickerOpen(false)
    navigate(`/projects/${newProjectId}`)
  }

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

  const handleCompleteCheckIn = useCallback(async (item: CheckIn, note?: string) => {
    setBusyCheckInId(item.id)
    const result = await api.completeCheckIn(item.id, {
      createdBy: 'human',
      note: note?.trim() || undefined,
    })
    setBusyCheckInId(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSelectedCheckInId((current) => current === item.id ? null : current)
    setCheckInNoteDraft('')
    await loadData()
    await onDataChanged?.()
  }, [loadData, onDataChanged])

  const handleSnoozeCheckIn = useCallback(async (item: CheckIn, remindAt: string) => {
    setBusyCheckInId(item.id)
    const result = await api.updateCheckIn(item.id, { remindAt })
    setBusyCheckInId(null)
    if (!result.ok) {
      setError(result.error)
      return false
    }
    setSnoozeMenuCheckInId(null)
    await loadData()
    await onDataChanged?.()
    return true
  }, [loadData, onDataChanged])

  const handlePresetSnoozeCheckIn = useCallback((item: CheckIn, preset: SnoozePreset) => {
    void handleSnoozeCheckIn(item, snoozeDate(preset))
  }, [handleSnoozeCheckIn])

  const handleOpenCustomSnoozeCheckIn = useCallback((item: CheckIn) => {
    setCustomSnoozeCheckInId(item.id)
    setCustomSnoozeAt(toDateTimeLocalValue(item.remindAt) || defaultCustomSnoozeValue())
    setSnoozeMenuCheckInId(null)
  }, [])

  async function handleSaveCustomSnooze() {
    if (!selectedCustomSnoozeCheckIn) return
    const remindAt = fromDateTimeLocalValue(customSnoozeAt)
    if (!remindAt) {
      setError(t('请选择提醒时间'))
      return
    }
    const ok = await handleSnoozeCheckIn(selectedCustomSnoozeCheckIn, remindAt)
    if (ok) {
      setCustomSnoozeCheckInId(null)
      setCustomSnoozeAt('')
    }
  }

  function closeCustomSnooze() {
    if (busyCheckInId) return
    setCustomSnoozeCheckInId(null)
    setCustomSnoozeAt('')
  }

  const visibleTodos = useMemo(() => {
    const base = globalTodos
    if (filterTags.length === 0) return base
    return base.filter((todo) =>
      filterTags.some((ft) => todo.tags.some((tag) => tag.toLowerCase() === ft.toLowerCase()))
    )
  }, [filterTags, globalTodos])

  const visibleCheckIns = useMemo(() => {
    if (sourceTab !== 'check_in') return []
    return globalCheckIns
  }, [globalCheckIns, sourceTab])

  const visibleArchivedTodos = useMemo(
    () => sourceTab === 'human' ? globalArchivedTodos : [],
    [globalArchivedTodos, sourceTab],
  )
  const hasActiveTagFilter = sourceTab === 'human' && filterTags.length > 0

  const humanCount = useMemo(
    () => globalTodos.filter((todo) => todo.status === 'pending').length,
    [globalTodos],
  )

  const progressCount = useMemo(
    () => activeQuestId
      ? globalTodos.filter((todo) => todo.originQuestId === activeQuestId && !todo.deleted).length
      : 0,
    [activeQuestId, globalTodos],
  )

  const checkInCount = useMemo(
    () => globalCheckIns.length,
    [globalCheckIns],
  )

  const openHumanTodos = useMemo(
    () => sortOpenTodos(visibleTodos.filter((todo) => todo.status === 'pending')),
    [visibleTodos],
  )

  const sortedCheckIns = useMemo(
    () => sortCheckIns(visibleCheckIns),
    [visibleCheckIns],
  )

  const projectRailGroups = useMemo(
    () => buildProjectRailGroups({
      projects,
      activeProjectId: sourceTab === 'check_in' ? null : projectId,
      activeProjectName: sourceTab === 'check_in' ? null : projectName,
      openTodos: sourceTab === 'human' ? openHumanTodos : [],
      checkIns: sourceTab === 'check_in' ? sortedCheckIns : [],
      source: sourceTab === 'check_in' ? 'check_in' : 'human',
      t,
    }),
    [openHumanTodos, projectId, projectName, projects, sortedCheckIns, sourceTab, t],
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
  const selectedCheckIn = useMemo(
    () => (selectedCheckInId ? globalCheckIns.find((item) => item.id === selectedCheckInId) ?? null : null),
    [globalCheckIns, selectedCheckInId],
  )
  const selectedCustomSnoozeCheckIn = useMemo(
    () => (customSnoozeCheckInId ? globalCheckIns.find((item) => item.id === customSnoozeCheckInId) ?? null : null),
    [customSnoozeCheckInId, globalCheckIns],
  )
  const modalRoot = typeof document !== 'undefined' ? document.body : null

  const hasVisibleContent = (
    openHumanTodos.length > 0
    || sortedCheckIns.length > 0
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
    setCheckInNoteDraft('')
  }, [selectedCheckInId])

  useEffect(() => {
    if (!selectedTodoId && !selectedCheckInId) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedTodoId(null)
        setSelectedCheckInId(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedCheckInId, selectedTodoId])

  function openCreateModal(kind: TaskComposerKind = 'human') {
    setCreateModalKind(kind)
    setCreateModalOpen(true)
  }

  async function handleCreateCheckIn() {
    if (!projectId) return
    const nextTitle = checkInDraft.title.trim()
    if (!nextTitle) {
      setError(t('打卡标题不能为空'))
      return
    }
    setCheckInSaving(true)
    const result = await api.createCheckIn({
      projectId,
      createdBy: 'human',
      originQuestId: activeQuestId || undefined,
      title: nextTitle,
      body: checkInDraft.body.trim() || undefined,
      remindAt: checkInDraft.remindAt.trim() ? fromDateTimeLocalValue(checkInDraft.remindAt) ?? undefined : undefined,
      priority: checkInDraft.priority,
    })
    setCheckInSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setCheckInDraft({
      title: '',
      body: '',
      remindAt: '',
      priority: 'normal',
    })
    setCreateCheckInOpen(false)
    await loadData()
    await onDataChanged?.()
  }

  function closeCreateCheckIn() {
    if (checkInSaving) return
    setCreateCheckInOpen(false)
    setCheckInDraft({
      title: '',
      body: '',
      remindAt: '',
      priority: 'normal',
    })
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

  const handleOpenTodo = useCallback((todoId: string) => {
    setSelectedCheckInId(null)
    setSelectedTodoId(todoId)
  }, [])

  const handleOpenCheckIn = useCallback((id: string) => {
    setSelectedTodoId(null)
    setSnoozeMenuCheckInId(null)
    setSelectedCheckInId(id)
  }, [])

  const handleToggleTodoStatus = useCallback((todo: Todo, nextStatus: Todo['status']) => {
    void handleUpdateTodo(todo, { status: nextStatus })
  }, [handleUpdateTodo])

  const handleOpenTodoSource = useCallback(() => {
    setSelectedTodoId(null)
  }, [])

  const handleOpenAutomationPanel = useCallback(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches) {
      onRequestClose?.()
    }
  }, [onRequestClose])

  const Wrapper = embedded ? 'div' : 'aside'
  const wrapperClass = embedded ? 'pluse-todo-embedded' : 'pluse-rail'

  // 嵌入模式下，外部容器已负责 tab 切换，不需要内部 tab 栏
  const hideInternalTabs = embedded

  return (
    <>
      <Wrapper className={wrapperClass}>
        {!embedded ? (
          <div className="pluse-mobile-panel-header">
            <button type="button" className="pluse-icon-button" onClick={onRequestClose} aria-label={t('关闭工作台')} title={t('关闭工作台')}>
              <CloseIcon className="pluse-icon" />
            </button>
          </div>
        ) : null}

        {!hideInternalTabs ? (
          <div className="pluse-rail-head pluse-rail-head-sidebar">
            <div className="pluse-sidebar-project-context pluse-workbench-project-context">
              <div className="pluse-workbench-project-strip">
                <div className="pluse-project-switcher pluse-rail-project-switcher">
                  <button
                    type="button"
                    className={`pluse-project-switcher-btn${projectPickerOpen ? ' is-open' : ''}`}
                    onClick={() => setProjectPickerOpen((value) => !value)}
                    aria-haspopup="listbox"
                    aria-expanded={projectPickerOpen}
                  >
                    <div className="pluse-project-switcher-label">
                      <strong>{activeProject?.name ?? t('选择项目')}</strong>
                      <span>{activeProjectContextLabel}</span>
                    </div>
                    <span className="pluse-project-switcher-chevron" aria-hidden="true">{projectPickerOpen ? '▴' : '▾'}</span>
                  </button>

                  {projectPickerOpen ? (
                    <div className="pluse-project-picker pluse-project-picker-rail">
                      <div className="pluse-project-picker-list" aria-label={t('选择项目')}>
                        {projectPickerGroups.length > 0 ? projectPickerGroups.map((group) => {
                          const groupOpen = expandedProjectPriorityGroups[group.key] ?? (group.priority === 'mainline' || group.priority === 'priority')
                          return (
                            <section key={group.key} className="pluse-project-picker-group">
                              <button
                                type="button"
                                className="pluse-project-picker-group-head"
                                onClick={() => setExpandedProjectPriorityGroups((current) => ({
                                  ...current,
                                  [group.key]: !(current[group.key] ?? (group.priority === 'mainline' || group.priority === 'priority')),
                                }))}
                              >
                                <strong><span aria-hidden="true">{groupOpen ? '▾' : '▸'}</span> {group.label}</strong>
                                <span>{t('{count} 个项目', { count: group.projects.length })}</span>
                              </button>
                              {groupOpen ? group.projects.map((project) => (
                                <button
                                  key={project.id}
                                  type="button"
                                  className={`pluse-project-picker-item${project.id === projectId ? ' is-active' : ''}`}
                                  onClick={() => openProject(project.id)}
                                >
                                  <span className="pluse-project-avatar is-compact" aria-hidden="true">{project.icon?.trim() || project.name.trim()[0]?.toUpperCase() || '#'}</span>
                                  <div className="pluse-project-picker-item-text">
                                    <strong>{project.name}</strong>
                                    <span className="pluse-project-picker-item-meta">
                                      <span>{projectDomainName(project)}</span>
                                      <span className={`pluse-project-priority-badge is-${project.priority}`}>{projectPriorityLabel(project.priority, t)}</span>
                                    </span>
                                  </div>
                                </button>
                              )) : null}
                            </section>
                          )
                        }) : (
                          <p className="pluse-domain-empty">{t('暂无项目')}</p>
                        )}
                      </div>
                    </div>
                  ) : null}
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
            <div className="pluse-sidebar-tabs pluse-sidebar-tabs-vertical pluse-rail-object-tabs" role="tablist" aria-label={t('对象类型')}>
              <button
                type="button"
                className={`pluse-sidebar-tab pluse-rail-object-tab${sourceTab === 'progress' ? ' is-active' : ''}`}
                onClick={() => activeQuestId && setSourceTab('progress')}
                aria-selected={sourceTab === 'progress'}
                aria-disabled={!activeQuestId}
                disabled={!activeQuestId}
                title={activeQuestId ? t('查看当前会话计划') : t('进入任一会话后可查看 Progress')}
              >
                {t('Progress')}
                {progressCount > 0 ? <span className="pluse-tab-count">{progressCount}</span> : null}
              </button>
              {scope !== 'project' ? (
                <>
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
                    className={`pluse-sidebar-tab pluse-rail-object-tab${sourceTab === 'check_in' ? ' is-active' : ''}`}
                    onClick={() => setSourceTab('check_in')}
                    aria-selected={sourceTab === 'check_in'}
                  >
                    {t('打卡')}
                    {checkInCount > 0 ? <span className="pluse-tab-count">{checkInCount}</span> : null}
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className={`pluse-sidebar-tab pluse-rail-object-tab${sourceTab === 'automation' ? ' is-active' : ''}`}
                onClick={() => setSourceTab('automation')}
                aria-selected={sourceTab === 'automation'}
              >
                {t('自动化')}
              </button>
            </div>
          </div>
        ) : null}

        {sourceTab === 'progress' ? (
          <div className="pluse-task-list is-progress-host">
            {activeQuestId ? (
              <ProgressRailPanel questId={activeQuestId} />
            ) : (
              <div className="pluse-rail-empty pluse-task-empty-state">
                <strong>{t('暂无 Progress')}</strong>
                <p>{t('进入一个会话后，这里会显示从上到下的计划流。')}</p>
              </div>
            )}
          </div>
        ) : null}

        {sourceTab === 'human' && projectTags.length > 0 ? (
          <div className="pluse-todo-tag-filter-row">
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

        {sourceTab === 'automation' ? (
          <AutomationRailPanel
            projectId={projectId}
            projectName={projectName ?? null}
            projects={projects}
            activeQuestId={activeQuestId}
            onRequestClose={onRequestClose}
            hideHeader
          />
        ) : null}

        {sourceTab !== 'progress' && sourceTab !== 'automation' ? (
          <div className="pluse-task-list">
          {projectRailGroups.map((group) => {
            const attentionTab = sourceTab === 'check_in'
            const expanded = attentionTab ? true : expandedProjectGroupKeys.includes(group.key)
            const groupCount = sourceTab === 'human' ? group.openTodos.length : group.checkIns.length
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
                    if (!attentionTab) {
                      setExpandedProjectGroupKeys((current) => (
                        current.includes(group.key)
                          ? current.filter((k) => k !== group.key)
                          : [...current, group.key]
                      ))
                    }
                  }}
                >
                  <span className="pluse-domain-group-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                  <div className="pluse-domain-group-copy">
                    <strong>{group.label}</strong>
                    <span>{groupCount}</span>
                  </div>
                </button>
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

                  {sourceTab === 'check_in' && group.checkIns.length > 0 ? (
                    <div className="pluse-task-folder-section">
                      <div className="pluse-note-list">
                        {group.checkIns.map((item) => (
                          <CheckInRailItem
                            key={item.id}
                            item={item}
                            activeQuestId={activeQuestId}
                            locale={locale}
                            t={t}
                            snoozeMenuOpen={snoozeMenuCheckInId === item.id}
                            busy={busyCheckInId === item.id}
                            highlighted={highlightedCheckInId === item.id}
                            onComplete={handleCompleteCheckIn}
                            onOpenCheckIn={handleOpenCheckIn}
                            onOpenSnoozeMenu={(id) => setSnoozeMenuCheckInId((current) => current === id ? null : id)}
                            onSnoozeCheckIn={handlePresetSnoozeCheckIn}
                            onCustomSnoozeCheckIn={handleOpenCustomSnoozeCheckIn}
                            onRequestClose={onRequestClose}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {!hasGroupContent ? (
                    <div className="pluse-rail-empty pluse-task-empty-state">
                      <strong>{t('暂无任务')}</strong>
                      <p>{formatEmptyMessage(sourceTab, t, scope)}</p>
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
              <p>{formatEmptyMessage(sourceTab, t, scope)}</p>
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
        ) : null}

        {sourceTab !== 'progress' ? (
          <section className="pluse-rail-section-new-task">
            <button
              type="button"
              className="pluse-sidebar-chip-link pluse-sidebar-new-session-card pluse-rail-new-task-card"
              onClick={() => {
                if (sourceTab === 'check_in') {
                  setCreateCheckInOpen(true)
                  return
                }
                openCreateModal('human')
              }}
              aria-label={sourceTab === 'check_in' ? t('新建打卡') : t('新建待办')}
              disabled={!projectId}
            >
              <PlusIcon className="pluse-icon" />
              <span>
                {scope === 'project' && projectName
                  ? (sourceTab === 'check_in'
                    ? t('在「{name}」新建打卡', { name: projectName })
                    : t('在「{name}」新建待办', { name: projectName }))
                  : (sourceTab === 'check_in' ? t('新建打卡') : t('新建待办'))}
              </span>
            </button>
          </section>
        ) : null}

        {error ? <p className="pluse-error" style={{ padding: '0 14px 14px' }}>{error}</p> : null}
      </Wrapper>

      <TaskComposerModal
        open={createModalOpen}
        projectId={projectId}
        projectName={projectName}
          initialKind={createModalKind}
        showKindSwitch={false}
        onClose={() => setCreateModalOpen(false)}
        onCreated={async () => {
          await loadData()
          await onDataChanged?.()
        }}
      />

      {createCheckInOpen && modalRoot ? createPortal(
        <div className="pluse-modal-backdrop pluse-todo-detail-backdrop" onClick={closeCreateCheckIn}>
          <section
            className="pluse-modal-panel pluse-todo-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="check-in-create-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="pluse-todo-detail-head">
              <div className="pluse-todo-detail-identity">
                <span className="pluse-task-detail-kicker">{t('打卡')}</span>
                <div className="pluse-task-detail-title-row">
                  <h2 id="check-in-create-title">{t('新建打卡')}</h2>
                </div>
              </div>
              <button
                type="button"
                className="pluse-icon-button"
                onClick={closeCreateCheckIn}
                aria-label={t('关闭')}
                title={t('关闭')}
                disabled={checkInSaving}
              >
                <CloseIcon className="pluse-icon" />
              </button>
            </header>

            <div className="pluse-todo-detail-body">
              <div className="pluse-form-grid pluse-todo-detail-form">
                <label>
                  <span>{t('标题')}</span>
                  <input
                    value={checkInDraft.title}
                    onChange={(event) => setCheckInDraft((current) => ({ ...current, title: event.target.value }))}
                    placeholder={t('输入打卡标题')}
                    maxLength={160}
                    autoFocus
                  />
                </label>
                <label>
                  <span>{t('时间')}</span>
                  <input
                    type="datetime-local"
                    value={checkInDraft.remindAt}
                    onChange={(event) => setCheckInDraft((current) => ({ ...current, remindAt: event.target.value }))}
                  />
                </label>
                <div className="pluse-form-field">
                  <span>{t('优先级')}</span>
                  <div className="pluse-priority-selector">
                    {(['urgent', 'high', 'normal', 'low'] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={`pluse-priority-option is-${p}${checkInDraft.priority === p ? ' is-active' : ''}`}
                        onClick={() => setCheckInDraft((current) => ({ ...current, priority: p }))}
                      >
                        {p === 'urgent' ? t('紧急') : p === 'high' ? t('高') : p === 'normal' ? t('普通') : t('低')}
                      </button>
                    ))}
                  </div>
                </div>
                <label>
                  <span>{t('内容')}</span>
                  <textarea
                    value={checkInDraft.body}
                    onChange={(event) => setCheckInDraft((current) => ({ ...current, body: event.target.value }))}
                    placeholder={t('补充打卡内容')}
                    rows={5}
                  />
                </label>
              </div>
            </div>

            <footer className="pluse-todo-detail-actions">
              <button
                type="button"
                className="pluse-button"
                onClick={() => void handleCreateCheckIn()}
                disabled={checkInSaving || !checkInDraft.title.trim()}
              >
                {checkInSaving ? t('保存中…') : t('创建打卡')}
              </button>
              <button
                type="button"
                className="pluse-button pluse-button-ghost"
                onClick={closeCreateCheckIn}
                disabled={checkInSaving}
              >
                {t('取消')}
              </button>
            </footer>
          </section>
        </div>,
        modalRoot,
      ) : null}

      {selectedCustomSnoozeCheckIn && modalRoot ? createPortal(
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
                <span className="pluse-task-detail-kicker">{t('打卡')}</span>
                <div className="pluse-task-detail-title-row">
                  <h2 id="reminder-snooze-title">{t('指定提醒时间')}</h2>
                </div>
                <div className="pluse-task-detail-meta">
                  <span>{selectedCustomSnoozeCheckIn.title}</span>
                </div>
              </div>
              <button
                type="button"
                className="pluse-icon-button"
                onClick={closeCustomSnooze}
                aria-label={t('关闭')}
                title={t('关闭')}
                disabled={Boolean(busyCheckInId)}
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
                disabled={Boolean(busyCheckInId) || !customSnoozeAt}
              >
                {busyCheckInId ? t('保存中…') : t('保存')}
              </button>
              <button
                type="button"
                className="pluse-button pluse-button-ghost"
                onClick={closeCustomSnooze}
                disabled={Boolean(busyCheckInId)}
              >
                {t('取消')}
              </button>
            </footer>
          </section>
        </div>,
        modalRoot,
      ) : null}

      {selectedCheckIn && modalRoot ? createPortal(
        <div className="pluse-modal-backdrop pluse-todo-detail-backdrop" onClick={() => setSelectedCheckInId(null)}>
          <section
            className="pluse-modal-panel pluse-todo-detail-modal pluse-reminder-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`check-in-detail-title-${selectedCheckIn.id}`}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="pluse-todo-detail-head">
              <div className="pluse-todo-detail-identity">
                <span className="pluse-task-detail-kicker">{t('打卡')}</span>
                <div className="pluse-task-detail-title-row">
                  <h2 id={`check-in-detail-title-${selectedCheckIn.id}`}>{selectedCheckIn.title}</h2>
                </div>
                <div className="pluse-task-detail-meta">
                  <span>{selectedCheckIn.remindAt ? `${t('提醒')} ${formatDateTime(selectedCheckIn.remindAt, locale, t)}` : t('无指定时间')}</span>
                  <span>{formatDateTime(selectedCheckIn.updatedAt, locale, t)}</span>
                </div>
              </div>
              <button
                type="button"
                className="pluse-icon-button"
                onClick={() => setSelectedCheckInId(null)}
                aria-label={t('关闭')}
                title={t('关闭')}
              >
                <CloseIcon className="pluse-icon" />
              </button>
            </header>

            <div className="pluse-todo-detail-body">
              {(selectedCheckIn.priority !== 'normal' || selectedCheckIn.remindAt) ? (
                <section className="pluse-todo-detail-section">
                  <div className="pluse-todo-detail-pills">
                    {selectedCheckIn.priority !== 'normal' ? (
                      <span className={`pluse-sidebar-badge pluse-priority-badge is-${selectedCheckIn.priority}`}>
                        {attentionPriorityLabel(selectedCheckIn.priority, t)}
                      </span>
                    ) : null}
                    {selectedCheckIn.remindAt ? (
                      <span className="pluse-sidebar-badge">
                        {t('提醒')} {formatDateTime(selectedCheckIn.remindAt, locale, t)}
                      </span>
                    ) : null}
                  </div>
                </section>
              ) : null}

              <section className="pluse-todo-detail-section">
                <h3>{t('内容')}</h3>
                <p className={selectedCheckIn.body ? undefined : 'is-empty'}>{selectedCheckIn.body || t('暂无打卡内容')}</p>
              </section>

              <section className="pluse-todo-detail-section">
                <h3>{t('打卡备注')}</h3>
                <textarea
                  className="pluse-check-in-note-input"
                  value={checkInNoteDraft}
                  onChange={(event) => setCheckInNoteDraft(event.currentTarget.value)}
                  placeholder={t('可选，记录这次实际情况')}
                  rows={3}
                />
              </section>

              {selectedCheckIn.originQuestId ? (
                <section className="pluse-todo-detail-section">
                  <h3>{t('来源')}</h3>
                  <Link
                    className="pluse-sidebar-chip-link"
                    to={`/quests/${selectedCheckIn.originQuestId}`}
                    onClick={() => {
                      setSelectedCheckInId(null)
                      onRequestClose?.()
                    }}
                  >
                    <RouteIcon className="pluse-icon" />
                    <span>{t('来源会话')}</span>
                  </Link>
                </section>
              ) : null}
            </div>

            <footer className="pluse-todo-detail-actions">
              <button
                type="button"
                className="pluse-button pluse-button-ghost"
                onClick={() => {
                  setSelectedCheckInId(null)
                  handleOpenCustomSnoozeCheckIn(selectedCheckIn)
                }}
                disabled={busyCheckInId === selectedCheckIn.id}
              >
                {t('延后打卡')}
              </button>
              <button
                type="button"
                className="pluse-button"
                onClick={() => {
                  void handleCompleteCheckIn(selectedCheckIn, checkInNoteDraft)
                }}
                disabled={busyCheckInId === selectedCheckIn.id}
              >
                {t('完成打卡')}
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
