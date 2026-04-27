import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, type Location as RouterLocation } from 'react-router-dom'
import type { AuthMe, Domain, Project, ProjectActivityItem, ProjectOverview, ProjectPriority, Quest, Todo, TokenUsageSummary } from '@pluse/types'
import * as api from '@/api/client'
import { useSseEvent } from '@/views/hooks/useSseEvent'
import { ArchiveIcon, ClockIcon, MenuIcon, MoonIcon, PauseIcon, PlayIcon, PlusIcon, RailIcon, RouteIcon, SidebarIcon, SlidersIcon, SparkIcon, SunIcon } from '@/views/components/icons'
import { SessionList } from '@/views/components/SessionList'
import { TodoPanel } from '@/views/components/TodoPanel'
import { TaskComposerModal } from '@/views/components/TaskComposerModal'
import { displayQuestName } from '@/views/utils/display'
import { getPreferredSession, rememberLastSession } from '@/views/utils/session-selection'
import { formatTodoScheduleSummary } from '@/views/utils/todo'
import { THEME_STORAGE_KEY, applyTheme, resolveInitialTheme, type ThemeMode } from '@/views/utils/theme'
import { LoginPage } from './LoginPage'
import { localeLabel, nextLocale, useI18n } from '@/i18n'

const ChatView = lazy(async () => import('@/views/components/ChatView').then((module) => ({ default: module.ChatView })))
const TaskDetail = lazy(async () => import('@/views/components/TaskDetail').then((module) => ({ default: module.TaskDetail })))
const SettingsPage = lazy(async () => import('./SettingsPage').then((module) => ({ default: module.SettingsPage })))

function shortPath(value?: string | null): string {
  if (!value) return ''
  const normalized = value.replace(/^\/Users\/[^/]+/, '~')
  const isHome = normalized.startsWith('~/')
  const parts = normalized.replace(/^~\//, '').replace(/^\//, '').split('/').filter(Boolean)
  if (parts.length <= 3) return normalized
  return `${isHome ? '~/' : '/'}${parts.slice(0, 2).join('/')}/…/${parts.slice(-2).join('/')}`
}

function projectAvatar(project: Pick<Project, 'name' | 'icon'>): string {
  const icon = project.icon?.trim()
  if (icon) return icon
  const name = project.name.trim()
  return name ? name[0]!.toUpperCase() : '#'
}

function projectPriorityLabel(priority: ProjectPriority, t: (key: string) => string): string {
  if (priority === 'mainline') return t('主线')
  if (priority === 'priority') return t('优先')
  if (priority === 'low') return t('低优先')
  return t('普通')
}

function formatDateTime(value?: string, t?: ((key: string) => string), locale = 'zh-CN'): string {
  if (!value) return t ? t('未记录') : '未记录'
  return new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatRelativeTime(value?: string, t?: (key: string, values?: Record<string, string>) => string): string {
  if (!value) return ''
  const timestamp = new Date(value).getTime()
  const delta = Math.max(0, Date.now() - timestamp)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day
  if (delta < minute) return t ? t('刚刚') : '刚刚'
  if (delta < hour) return t ? t('{count} 分钟', { count: String(Math.max(1, Math.floor(delta / minute))) }) : `${Math.max(1, Math.floor(delta / minute))} 分钟`
  if (delta < day) return t ? t('{count} 小时', { count: String(Math.max(1, Math.floor(delta / hour))) }) : `${Math.max(1, Math.floor(delta / hour))} 小时`
  if (delta < week) return t ? t('{count} 天', { count: String(Math.max(1, Math.floor(delta / day))) }) : `${Math.max(1, Math.floor(delta / day))} 天`
  return t ? t('{count} 周', { count: String(Math.max(1, Math.floor(delta / week))) }) : `${Math.max(1, Math.floor(delta / week))} 周`
}

function formatOutputStatus(status: string, t?: (key: string) => string): string {
  const normalized = status.toLowerCase()
  if (normalized === 'completed' || normalized === 'done') return t ? t('已完成') : '已完成'
  if (normalized === 'running') return t ? t('执行中') : '执行中'
  if (normalized === 'failed') return t ? t('失败') : '失败'
  if (normalized === 'cancelled') return t ? t('已取消') : '已取消'
  if (normalized === 'pending') return t ? t('待处理') : '待处理'
  if (normalized === 'idle') return t ? t('空闲') : '空闲'
  return status
}

function scheduleSummary(schedule: ProjectOverview['schedule'], locale?: string, t?: (key: string, value?: Record<string, string>) => string): string {
  if (!schedule) return t ? t('暂无周期触发') : '暂无周期触发'
  if (schedule.lastRunAt && schedule.nextRunAt) {
    return `${formatDateTime(schedule.lastRunAt, t, locale)} → ${formatDateTime(schedule.nextRunAt, t, locale)}`
  }
  if (schedule.nextRunAt) return t
    ? t('下次 {{time}}', { time: formatDateTime(schedule.nextRunAt, t, locale) })
    : `下次 ${formatDateTime(schedule.nextRunAt)}`
  if (schedule.lastRunAt) return t
    ? t('最近 {{time}}', { time: formatDateTime(schedule.lastRunAt, t, locale) })
    : `最近 ${formatDateTime(schedule.lastRunAt)}`
  return t ? t('已配置，未触发') : '已配置，未触发'
}

function questLabel(quest: Quest, t?: (key: string) => string): string {
  return displayQuestName(quest, t)
}

type AutomationSectionKey = 'running' | 'attention' | 'recurring' | 'scheduled' | 'manual'
type AutomationHealthKey = 'attention' | 'running' | 'scheduled' | 'manual' | 'empty'
type AutomationTimelineGroup = {
  key: string
  label: string
  items: Array<{ quest: Quest; runAt: string }>
}

type ProjectAutomationSummary = {
  total: number
  running: number
  attention: number
  disabled: number
  nextRunAt?: string
  health: AutomationHealthKey
}

function automationNextRunAt(quest: Quest): string | undefined {
  return quest.scheduleConfig?.nextRunAt
    ?? (quest.scheduleKind === 'scheduled' ? quest.scheduleConfig?.runAt : undefined)
}

function safeDateValue(value?: string): number {
  if (!value) return Number.POSITIVE_INFINITY
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
}

function isAutomationRunning(quest: Quest): boolean {
  return Boolean(quest.activeRunId) || quest.status === 'running'
}

function isAutomationAttention(quest: Quest): boolean {
  return quest.status === 'failed' || quest.status === 'cancelled'
}

function isAutomationManual(quest: Quest): boolean {
  return quest.scheduleKind === 'once' || !quest.scheduleKind
}

function summarizeProjectAutomations(tasks: Quest[]): ProjectAutomationSummary {
  const running = tasks.filter(isAutomationRunning).length
  const attention = tasks.filter(isAutomationAttention).length
  const disabled = tasks.filter((quest) => quest.enabled === false).length
  const now = Date.now()
  const nextRunAt = tasks
    .map(automationNextRunAt)
    .filter((value): value is string => Boolean(value))
    .filter((value) => safeDateValue(value) >= now)
    .sort((left, right) => safeDateValue(left) - safeDateValue(right))[0]

  let health: AutomationHealthKey = 'empty'
  if (attention > 0) health = 'attention'
  else if (running > 0) health = 'running'
  else if (nextRunAt) health = 'scheduled'
  else if (tasks.length > 0) health = tasks.every(isAutomationManual) ? 'manual' : 'scheduled'

  return {
    total: tasks.length,
    running,
    attention,
    disabled,
    nextRunAt,
    health,
  }
}

function automationHealthLabel(health: AutomationHealthKey, t: (key: string) => string): string {
  if (health === 'attention') return t('需要关注')
  if (health === 'running') return t('运行中')
  if (health === 'scheduled') return t('已排程')
  if (health === 'manual') return t('手动')
  return t('未配置')
}

function automationSectionKey(quest: Quest): AutomationSectionKey {
  if (isAutomationRunning(quest)) return 'running'
  if (isAutomationAttention(quest)) return 'attention'
  if (quest.scheduleKind === 'recurring') return 'recurring'
  if (quest.scheduleKind === 'scheduled') return 'scheduled'
  return 'manual'
}

function automationSectionLabel(key: AutomationSectionKey, t: (key: string) => string): string {
  if (key === 'running') return t('运行中')
  if (key === 'attention') return t('异常')
  if (key === 'recurring') return t('周期')
  if (key === 'scheduled') return t('定时')
  return t('手动')
}

function automationSectionHint(key: AutomationSectionKey, t: (key: string) => string): string {
  if (key === 'running') return t('正在执行的自动化')
  if (key === 'attention') return t('需要处理失败或取消')
  if (key === 'recurring') return t('按周期运行')
  if (key === 'scheduled') return t('等待定时触发')
  return t('手动触发')
}

function automationScheduleKindLabel(quest: Quest, t: (key: string) => string): string {
  if (quest.scheduleKind === 'recurring') return t('周期')
  if (quest.scheduleKind === 'scheduled') return t('定时')
  return t('手动')
}

function automationStatusLabel(quest: Quest, t: (key: string) => string): string {
  return isAutomationRunning(quest) ? t('运行中') : formatOutputStatus(quest.status ?? 'pending', t)
}

function automationTimeLabel(
  quest: Quest,
  locale: string,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (isAutomationRunning(quest)) return t('运行中')
  if (quest.enabled === false) return t('已暂停')
  const nextRunAt = automationNextRunAt(quest)
  if (nextRunAt) return t('下次 {{time}}', { time: formatDateTime(nextRunAt, t, locale) })
  if (quest.scheduleConfig?.lastRunAt) return t('最近 {{time}}', { time: formatDateTime(quest.scheduleConfig.lastRunAt, t, locale) })
  if (isAutomationManual(quest)) return t('手动')
  return formatRelativeTime(quest.updatedAt, t)
}

function automationTimeTitle(
  quest: Quest,
  locale: string,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const nextRunAt = automationNextRunAt(quest)
  if (nextRunAt) return `${t('下次运行')} · ${formatDateTime(nextRunAt, t, locale)}`
  if (quest.scheduleConfig?.lastRunAt) return `${t('最近')} · ${formatDateTime(quest.scheduleConfig.lastRunAt, t, locale)}`
  return formatDateTime(quest.updatedAt, t, locale)
}

function automationClockLabel(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function automationDayLabel(value: string, locale: string, t: (key: string) => string): string {
  const date = new Date(value)
  const today = new Date()
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  const key = localDayKey(date)
  if (key === localDayKey(today)) return t('今天')
  if (key === localDayKey(tomorrow)) return t('明天')
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
  }).format(date)
}

function buildAutomationTimelineGroups(tasks: Quest[], locale: string, t: (key: string) => string): AutomationTimelineGroup[] {
  const timedItems = tasks
    .map((quest) => ({ quest, runAt: automationNextRunAt(quest) }))
    .filter((item): item is { quest: Quest; runAt: string } => Boolean(item.runAt))
    .sort((left, right) => safeDateValue(left.runAt) - safeDateValue(right.runAt))
  const grouped = new Map<string, AutomationTimelineGroup>()
  for (const item of timedItems) {
    const key = localDayKey(new Date(item.runAt))
    const existing = grouped.get(key)
    if (existing) existing.items.push(item)
    else grouped.set(key, {
      key,
      label: automationDayLabel(item.runAt, locale, t),
      items: [item],
    })
  }
  return [...grouped.values()]
}

function sortAutomationItems(tasks: Quest[]): Quest[] {
  return [...tasks].sort((left, right) => {
    const leftNext = safeDateValue(automationNextRunAt(left))
    const rightNext = safeDateValue(automationNextRunAt(right))
    if (leftNext !== rightNext) return leftNext - rightNext
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  })
}

function buildAutomationSections(tasks: Quest[]): Array<{ key: AutomationSectionKey; items: Quest[] }> {
  const order: AutomationSectionKey[] = ['running', 'attention', 'recurring', 'scheduled', 'manual']
  const grouped = new Map<AutomationSectionKey, Quest[]>()
  for (const quest of sortAutomationItems(tasks)) {
    const key = automationSectionKey(quest)
    grouped.set(key, [...(grouped.get(key) ?? []), quest])
  }
  return order
    .map((key) => ({ key, items: grouped.get(key) ?? [] }))
    .filter((entry) => entry.items.length > 0)
}

function taskOverlayState(location: RouterLocation): { backgroundLocation: RouterLocation } {
  const existingBackground = (location.state as { backgroundLocation?: RouterLocation } | null)?.backgroundLocation
  return { backgroundLocation: existingBackground ?? location }
}

type QuestRouteState = {
  backgroundLocation?: RouterLocation
  initialQuest?: Quest | null
}

type ProjectPageTab = 'overview' | 'automation' | 'settings'

function WorkspaceSection(props: {
  title: string
  hint?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="pluse-detail-section">
      <header className="pluse-detail-section-head">
        <div>
          <h2>{props.title}</h2>
          {props.hint ? <p>{props.hint}</p> : null}
        </div>
        {props.action}
      </header>
      {props.children}
    </section>
  )
}

function RouteLoading({ message }: { message: string }) {
  return <div className="pluse-page pluse-page-loading">{message}</div>
}

function ProjectCompactSection(props: {
  title: string
  count?: number
  defaultOpen?: boolean
  note?: string
  scrollable?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? true)

  useEffect(() => {
    setOpen(props.defaultOpen ?? true)
  }, [props.defaultOpen])

  return (
    <section className={`pluse-project-group${open ? ' is-open' : ' is-collapsed'}`}>
      <button
        type="button"
        className="pluse-project-group-head"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <div className="pluse-project-group-head-main">
          <span className="pluse-project-group-title">{props.title}</span>
          {typeof props.count === 'number' ? <span className="pluse-project-group-count">{props.count}</span> : null}
          {props.note ? <span className="pluse-project-group-note">{props.note}</span> : null}
        </div>
        <span className={`pluse-project-group-chevron${open ? ' is-open' : ''}`} aria-hidden="true">
          ⌄
        </span>
      </button>
      {open ? (
        <div className={`pluse-project-group-body${props.scrollable ? ' is-scrollable' : ''}`}>
          {props.children}
        </div>
      ) : null}
    </section>
  )
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function ProjectOverviewHero({
  overview,
  tokenSummary,
  locale,
  t,
}: {
  overview: ProjectOverview
  tokenSummary: TokenUsageSummary | null
  locale: string
  t: (key: string, values?: Record<string, string>) => string
}) {
  const activeCount = [...overview.sessions, ...overview.tasks].filter((quest) => Boolean(quest.activeRunId)).length
  const waitingCount = overview.waitingTodos.length
  const pendingTodoCount = overview.todos.filter((todo) => todo.status === 'pending').length
  const queuedCount = overview.sessions.reduce((sum, session) => sum + session.followUpQueue.length, 0)
  const actionablePendingCount = Math.max(pendingTodoCount - waitingCount, 0)
  const completedRecentCount = overview.recentActivity.filter((item) => item.op === 'done').length
  const metrics = useMemo(
    () => [
      { label: t('运行中'), value: activeCount, color: 'var(--accent-strong)' },
      { label: t('待处理'), value: actionablePendingCount, color: 'color-mix(in srgb, var(--warning) 78%, var(--accent-strong))' },
      { label: t('等待中'), value: waitingCount, color: 'color-mix(in srgb, var(--success) 82%, var(--accent-strong))' },
      { label: t('排队消息'), value: queuedCount, color: 'color-mix(in srgb, var(--text-muted) 82%, white)' },
    ],
    [activeCount, actionablePendingCount, queuedCount, t, waitingCount],
  )
  const total = useMemo(
    () => metrics.reduce((sum, metric) => sum + metric.value, 0),
    [metrics],
  )
  const number = useMemo(() => new Intl.NumberFormat(locale), [locale])
  const latestActivityAt = overview.recentActivity[0]?.createdAt
  const topSummary = latestActivityAt
    ? `${t('最近活动')} ${formatDateTime(latestActivityAt, t, locale)}`
    : scheduleSummary(overview.schedule, locale, t)
  const recentActivityCount = overview.recentActivity.length
  const activityPreview = useMemo(
    () => overview.recentActivity.slice(0, 6),
    [overview.recentActivity],
  )

  const radius = 44
  const circumference = 2 * Math.PI * radius
  const segments = useMemo(() => {
    if (total === 0) return []
    const gap = 5
    return metrics
      .filter((metric) => metric.value > 0)
      .reduce<{ offset: number; segments: ReactNode[] }>(
        (acc, metric) => {
          const rawLength = (metric.value / total) * circumference
          const visibleLength = Math.max(rawLength - gap, 0)
          acc.segments.push(
            <circle
              key={metric.label}
              className="pluse-overview-ring-segment"
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke={metric.color}
              strokeWidth="11"
              strokeLinecap="round"
              strokeDasharray={`${visibleLength} ${Math.max(circumference - visibleLength, 0)}`}
              strokeDashoffset={-acc.offset}
            />,
          )
          return {
            offset: acc.offset + rawLength,
            segments: acc.segments,
          }
        },
        { offset: 0, segments: [] },
      )
      .segments
  }, [circumference, metrics, radius, total])

  return (
    <section className="pluse-overview-hero">
      <div className="pluse-overview-lead">
        <div className="pluse-overview-lead-top">
          <span className="pluse-overview-kicker">{t('待推进')}</span>
          <span className="pluse-overview-schedule-text">{topSummary}</span>
        </div>

        <div className="pluse-overview-total">
          <strong>{number.format(total)}</strong>
          <div className="pluse-overview-total-copy">
            <span>{overview.project.name}</span>
            <p>
              {total > 0
                ? t('当前需要继续推进 {count} 项工作', { count: number.format(total) })
                : t('当前没有待推进的工作')}
            </p>
            <div className="pluse-overview-total-stats">
              <span>{t('最近活动')} {number.format(recentActivityCount)}</span>
              <span>{t('已完成')} {number.format(completedRecentCount)}</span>
            </div>
          </div>
        </div>

        <div className="pluse-overview-metrics">
          {metrics.map((metric) => {
            const ratio = total > 0 ? Math.round((metric.value / total) * 100) : 0
            return (
              <div key={metric.label} className="pluse-overview-metric">
                <span className="pluse-overview-metric-label">
                  <i className="pluse-overview-metric-dot" aria-hidden="true" style={{ background: metric.color }} />
                  {metric.label}
                </span>
                <strong>{number.format(metric.value)}</strong>
                <small>{ratio}%</small>
              </div>
            )
          })}
        </div>
      </div>

      <div className="pluse-overview-visual" aria-label={t('概览')}>
        <div className="pluse-overview-visual-top">
          <div className="pluse-overview-ring">
            <svg viewBox="0 0 120 120" role="img" aria-label={t('概览')}>
              <circle className="pluse-overview-ring-track" cx="60" cy="60" r={radius} fill="none" strokeWidth="11" />
              <g transform="rotate(-90 60 60)">{segments}</g>
            </svg>
            <div className="pluse-overview-ring-center">
              <strong>{number.format(total)}</strong>
              <span>{t('待推进')}</span>
            </div>
          </div>

          <div className="pluse-overview-aside">
            <div className="pluse-overview-aside-item">
              <span>{t('最近活动')}</span>
              <strong>{number.format(recentActivityCount)}</strong>
            </div>
            <div className="pluse-overview-aside-item">
              <span>{t('已完成')}</span>
              <strong>{number.format(completedRecentCount)}</strong>
            </div>
            {tokenSummary && tokenSummary.runCount > 0 ? (
              <div className="pluse-overview-aside-item">
                <span>{t('Token 消耗')}</span>
                <strong>
                  {formatTokenCount(tokenSummary.inputTokens + tokenSummary.outputTokens)}
                  {tokenSummary.costUsd != null ? ` · $${tokenSummary.costUsd.toFixed(2)}` : ''}
                </strong>
              </div>
            ) : null}
          </div>
        </div>

        <div className="pluse-overview-log">
          <div className="pluse-overview-log-head">
            <span>{t('操作日志')}</span>
            <strong>{number.format(recentActivityCount)}</strong>
          </div>
          {activityPreview.length > 0 ? (
            <div className="pluse-output-list pluse-overview-log-list">
              {activityPreview.map((item) => (
                <ActivityRow key={item.id} item={item} t={t} locale={locale} compact />
              ))}
            </div>
          ) : (
            <p className="pluse-empty-inline">{t('暂无操作记录')}</p>
          )}
        </div>
      </div>
    </section>
  )
}

function formatActivitySubjectType(type: ProjectActivityItem['subjectType'], t: (key: string, values?: Record<string, string>) => string): string {
  if (type === 'session') return t('会话')
  if (type === 'task') return t('自动化')
  if (type === 'reminder') return t('提醒')
  return t('待办')
}

function formatActivityOp(item: ProjectActivityItem, t: (key: string, values?: Record<string, string>) => string): string {
  if (item.op === 'created') return item.subjectType === 'session' ? t('创建会话') : item.subjectType === 'task' ? t('创建自动化') : item.subjectType === 'reminder' ? t('创建提醒') : t('创建待办')
  if (item.op === 'kind_changed') return item.toKind === 'task' ? t('转为自动化') : t('转为会话')
  if (item.op === 'project_changed_in') return t('移入项目')
  if (item.op === 'project_changed_out') return t('移出项目')
  if (item.op === 'triggered') return t('开始执行')
  if (item.op === 'done') return item.subjectType === 'todo' ? t('待办完成') : item.subjectType === 'reminder' ? t('提醒完成') : t('运行完成')
  if (item.op === 'failed') return t('执行失败')
  if (item.op === 'cancelled') return item.subjectType === 'todo' ? t('待办取消') : item.subjectType === 'reminder' ? t('提醒取消') : t('执行取消')
  if (item.op === 'deleted') return t('已归档')
  return t('状态变更')
}

function formatActivityDetail(item: ProjectActivityItem, t: (key: string, values?: Record<string, string>) => string): string | null {
  if (item.note?.trim()) return item.note.trim()
  if (item.op === 'kind_changed' && item.fromKind && item.toKind) {
    return `${item.fromKind === 'task' ? t('自动化') : t('会话')} → ${item.toKind === 'task' ? t('自动化') : t('会话')}`
  }
  if (item.fromStatus && item.toStatus && item.fromStatus !== item.toStatus) {
    return `${formatOutputStatus(item.fromStatus, t)} → ${formatOutputStatus(item.toStatus, t)}`
  }
  return null
}

function activityTone(item: ProjectActivityItem): string {
  if (item.op === 'done') return 'completed'
  if (item.op === 'failed') return 'failed'
  if (item.op === 'cancelled' || item.op === 'deleted') return 'cancelled'
  if (item.op === 'triggered') return 'running'
  return 'pending'
}

function ActivityRow({
  item,
  t,
  locale,
  compact = false,
}: {
  item: ProjectActivityItem
  t: (key: string, values?: Record<string, string>) => string
  locale: string
  compact?: boolean
}) {
  const location = useLocation()
  const target = item.subjectType === 'todo'
    ? undefined
    : item.subjectType === 'reminder'
      ? item.questId ? `/quests/${item.questId}` : undefined
      : `/quests/${item.subjectId}`
  const detail = formatActivityDetail(item, t)
  const className = `pluse-output-row pluse-activity-row${compact ? ' is-compact' : ''}`
  const content = (
    <>
      <div className="pluse-output-row-main">
        <div className="pluse-output-row-top">
          <strong>{item.title}</strong>
          <span className={`pluse-activity-op is-${activityTone(item)}`}>{formatActivityOp(item, t)}</span>
        </div>
        {detail ? <p>{detail}</p> : null}
      </div>
      <div className="pluse-output-row-meta">
        <span>{formatActivitySubjectType(item.subjectType, t)}</span>
        <span className="pluse-meta-inline">
          <ClockIcon className="pluse-icon pluse-inline-icon" />
          {formatDateTime(item.createdAt, t, locale)}
        </span>
      </div>
    </>
  )

  return target ? (
    <Link
      className={className}
      to={target}
      state={item.subjectType === 'task' ? taskOverlayState(location) : undefined}
    >
      {content}
    </Link>
  ) : <div className={className}>{content}</div>
}

function WaitingTodoRow({
  todo,
  locale,
  t,
  disabled = false,
  onToggle,
}: {
  todo: Todo
  locale: string
  t: (key: string, values?: Record<string, string>) => string
  disabled?: boolean
  onToggle: (todo: Todo) => Promise<void> | void
}) {
  const location = useLocation()
  const note = todo.waitingInstructions || todo.description || t('等待新的输入后再继续。')
  const scheduleSummary = formatTodoScheduleSummary(todo, locale, t)
  const completeLabel = todo.repeat !== 'none' ? t('完成本次') : t('完成任务')

  return (
    <article className="pluse-sidebar-item pluse-sidebar-row pluse-task-list-item is-todo pluse-overview-waiting-item">
      <button
        type="button"
        className="pluse-todo-toggle"
        onClick={() => void onToggle(todo)}
        aria-label={completeLabel}
        title={completeLabel}
        disabled={disabled}
      >
      </button>
      <div className="pluse-task-list-main pluse-overview-waiting-main">
        <div className="pluse-task-list-copy">
          <div className="pluse-sidebar-item-title">
            <strong>{todo.title}</strong>
          </div>
          <p className="pluse-task-list-note">{note}</p>
          {scheduleSummary ? <p className="pluse-task-list-note is-secondary">{scheduleSummary}</p> : null}
          <div className="pluse-task-list-meta" title={formatDateTime(todo.updatedAt, t, locale)}>
            <span className={`pluse-task-list-state is-${todo.status}`}>{formatOutputStatus(todo.status, t)}</span>
            <span className="pluse-task-list-dot" aria-hidden="true">·</span>
            <span className="pluse-meta-inline">
              <ClockIcon className="pluse-icon pluse-inline-icon" />
              {formatRelativeTime(todo.updatedAt, t)}
            </span>
          </div>
        </div>
      </div>
      <div className="pluse-sidebar-item-actions">
        {todo.originQuestId ? (
          <Link
            className="pluse-sidebar-action-btn pluse-task-source-link"
            to={`/quests/${todo.originQuestId}`}
            aria-label={t('来源会话')}
            title={t('来源会话')}
          >
            <RouteIcon className="pluse-icon" />
          </Link>
        ) : null}
      </div>
    </article>
  )
}

function ProjectAutomationPanel({
  overview,
  locale,
  t,
  onChanged,
  onError,
  standalone = false,
}: {
  overview: ProjectOverview
  locale: string
  t: (key: string, values?: Record<string, string | number>) => string
  onChanged: () => Promise<void>
  onError: (message: string | null) => void
  standalone?: boolean
}) {
  const location = useLocation()
  const [busyQuestId, setBusyQuestId] = useState<string | null>(null)
  const [createAutomationOpen, setCreateAutomationOpen] = useState(false)
  const tasks = useMemo(
    () => sortAutomationItems(overview.tasks.filter((quest) => !quest.deleted)),
    [overview.tasks],
  )
  const summary = useMemo(() => summarizeProjectAutomations(tasks), [tasks])
  const timelineTasks = useMemo(
    () => tasks.filter((quest) => !isAutomationManual(quest) && Boolean(automationNextRunAt(quest))),
    [tasks],
  )
  const timelineGroups = useMemo(
    () => buildAutomationTimelineGroups(timelineTasks, locale, t),
    [locale, t, timelineTasks],
  )
  const todayTimelineCount = useMemo(() => {
    const todayKey = localDayKey(new Date())
    return timelineGroups
      .find((group) => group.key === todayKey)
      ?.items.length ?? 0
  }, [timelineGroups])
  const untimedTasks = useMemo(() => {
    const timelineIds = new Set(timelineTasks.map((quest) => quest.id))
    return tasks.filter((quest) => !timelineIds.has(quest.id))
  }, [tasks, timelineTasks])
  const sections = useMemo(
    () => buildAutomationSections(untimedTasks).map((section) => ({
      ...section,
      label: automationSectionLabel(section.key, t),
      hint: automationSectionHint(section.key, t),
    })),
    [untimedTasks, t],
  )
  const questLinkState = useMemo(
    () => taskOverlayState(location),
    [location],
  )
  const healthLabel = automationHealthLabel(summary.health, t)

  async function waitForQuestRunCleared(questId: string): Promise<boolean> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const current = await api.getQuest(questId)
      if (current.ok && !current.data.activeRunId) return true
      await new Promise((resolve) => window.setTimeout(resolve, 150))
    }
    return false
  }

  async function cancelActiveRunIfNeeded(quest: Quest, message: string): Promise<boolean> {
    if (!quest.activeRunId) return true
    const confirmed = window.confirm(message)
    if (!confirmed) return false
    const cancelled = await api.cancelRun(quest.activeRunId)
    if (!cancelled.ok) {
      onError(cancelled.error)
      return false
    }
    const cleared = await waitForQuestRunCleared(quest.id)
    if (!cleared) {
      onError(t('当前执行尚未完全停止，请稍后再试'))
      return false
    }
    return true
  }

  async function handleTriggerAutomation(quest: Quest) {
    setBusyQuestId(quest.id)
    onError(null)
    try {
      const result = await api.startQuestRun(quest.id, { trigger: 'manual', triggeredBy: 'human' })
      if (!result.ok) {
        onError(result.error)
        return
      }
      await onChanged()
    } finally {
      setBusyQuestId(null)
    }
  }

  async function handleToggleAutomation(quest: Quest) {
    const nextEnabled = quest.enabled === false
    setBusyQuestId(quest.id)
    onError(null)
    try {
      if (!nextEnabled) {
        const canContinue = await cancelActiveRunIfNeeded(quest, t('当前任务正在运行，停用前会先取消当前执行。继续吗？'))
        if (!canContinue) return
      }
      const result = await api.updateQuest(quest.id, { enabled: nextEnabled })
      if (!result.ok) {
        onError(result.error)
        return
      }
      await onChanged()
    } finally {
      setBusyQuestId(null)
    }
  }

  async function handleArchiveAutomation(quest: Quest) {
    setBusyQuestId(quest.id)
    onError(null)
    try {
      const canContinue = await cancelActiveRunIfNeeded(quest, t('当前任务正在运行，归档前会先取消当前执行。继续吗？'))
      if (!canContinue) return
      const result = await api.updateQuest(quest.id, { deleted: true })
      if (!result.ok) {
        onError(result.error)
        return
      }
      await onChanged()
    } finally {
      setBusyQuestId(null)
    }
  }

  function renderAutomationRow(quest: Quest, sectionKey: AutomationSectionKey, runAt?: string) {
    const isPaused = quest.enabled === false
    const isBusy = busyQuestId === quest.id
    const canTrigger = !isBusy && !quest.activeRunId && quest.enabled !== false
    const statusKey = quest.activeRunId ? 'running' : quest.status ?? 'pending'
    const rowClassName = [
      'pluse-project-automation-row',
      runAt ? 'pluse-project-automation-timeline-row' : '',
      `is-${sectionKey}`,
      isPaused ? 'is-paused' : '',
    ].filter(Boolean).join(' ')
    return (
      <article key={quest.id} className={rowClassName}>
        {runAt ? (
          <div className="pluse-project-automation-time-slot" title={formatDateTime(runAt, t, locale)}>
            <strong>{automationClockLabel(runAt, locale)}</strong>
            <span>{automationScheduleKindLabel(quest, t)}</span>
          </div>
        ) : null}
        <Link
          className="pluse-project-automation-clickzone"
          to={`/quests/${quest.id}`}
          state={{ ...questLinkState, initialQuest: quest }}
        >
          <div className="pluse-project-automation-main">
            <div className="pluse-project-automation-title">
              <span className="pluse-task-kind-badge" aria-label={t('自动化')} title={t('自动化')}>
                <SparkIcon className="pluse-icon" />
              </span>
              <strong>{questLabel(quest, t)}</strong>
            </div>
            {quest.description ? <p>{quest.description}</p> : null}
          </div>
          <div className="pluse-project-automation-side">
            <span className={`pluse-automation-state-chip is-${statusKey}`}>
              {automationStatusLabel(quest, t)}
            </span>
            <div className="pluse-project-automation-meta" title={automationTimeTitle(quest, locale, t)}>
              <span>{automationScheduleKindLabel(quest, t)}</span>
              <span className="pluse-meta-inline">
                <ClockIcon className="pluse-icon pluse-inline-icon" />
                {automationTimeLabel(quest, locale, t)}
              </span>
              {isPaused ? <span>{t('已暂停')}</span> : null}
            </div>
          </div>
        </Link>
        <div className="pluse-project-automation-actions">
          <button
            type="button"
            className="pluse-sidebar-action-btn"
            onClick={() => void handleTriggerAutomation(quest)}
            aria-label={t('立即触发')}
            title={t('立即触发')}
            disabled={!canTrigger}
          >
            <PlayIcon className="pluse-icon" />
          </button>
          <button
            type="button"
            className="pluse-sidebar-action-btn"
            onClick={() => void handleToggleAutomation(quest)}
            aria-label={isPaused ? t('恢复自动化') : t('暂停自动化')}
            title={isPaused ? t('恢复自动化') : t('暂停自动化')}
            disabled={isBusy}
          >
            {isPaused ? <PlayIcon className="pluse-icon" /> : <PauseIcon className="pluse-icon" />}
          </button>
          <button
            type="button"
            className="pluse-sidebar-action-btn"
            onClick={() => void handleArchiveAutomation(quest)}
            aria-label={t('归档')}
            title={t('归档')}
            disabled={isBusy}
          >
            <ArchiveIcon className="pluse-icon" />
          </button>
        </div>
      </article>
    )
  }

  const content = (
      <div id="automation" className="pluse-project-automation-panel">
        {standalone ? (
          <header className="pluse-project-automation-page-head">
            <div className="pluse-project-automation-page-title">
              <span className="pluse-project-automation-kicker">{t('项目自动化')}</span>
              <h2>{t('自动化面板')}</h2>
            </div>
            <div className="pluse-project-automation-page-actions">
              <button
                type="button"
                className="pluse-button pluse-button-compact"
                onClick={() => setCreateAutomationOpen(true)}
              >
                <PlusIcon className="pluse-icon" />
                {t('新建自动化')}
              </button>
            </div>
          </header>
        ) : null}
        <div className="pluse-project-automation-summary" aria-label={t('自动化面板')}>
          <div className={`pluse-project-automation-summary-health is-${summary.health}`}>
            <span>{t('面板状态')}</span>
            <strong>{healthLabel}</strong>
            <small>
              {summary.nextRunAt
                ? `${t('下次运行')} ${formatDateTime(summary.nextRunAt, t, locale)}`
                : t('暂无下次运行')}
            </small>
          </div>
          <div className="pluse-project-automation-summary-metrics">
            <div className="pluse-project-automation-summary-cell">
              <span>{t('自动化数')}</span>
              <strong>{summary.total}</strong>
            </div>
            <div className="pluse-project-automation-summary-cell">
              <span>{t('运行中')}</span>
              <strong>{summary.running}</strong>
            </div>
            <div className={`pluse-project-automation-summary-cell${summary.attention > 0 ? ' is-attention' : ''}`}>
              <span>{t('需要关注')}</span>
              <strong>{summary.attention}</strong>
            </div>
            <div className="pluse-project-automation-summary-cell">
              <span>{t('已暂停')}</span>
              <strong>{summary.disabled}</strong>
            </div>
          </div>
        </div>

        {tasks.length > 0 ? (
          <div className="pluse-project-automation-sections">
            <section className="pluse-project-automation-section pluse-project-automation-timeline">
              <header className="pluse-project-automation-section-head">
                <div>
                  <span>{t('执行时间线')}</span>
                  <strong>{timelineTasks.length}</strong>
                </div>
                <p>
                  {todayTimelineCount > 0
                    ? t('今日执行 {{count}} 个', { count: todayTimelineCount })
                    : t('今天暂无定时执行')}
                </p>
              </header>
              {timelineGroups.length > 0 ? (
                <div className="pluse-project-automation-timeline-days">
                  {timelineGroups.map((group) => (
                    <section key={group.key} className="pluse-project-automation-timeline-day">
                      <header className="pluse-project-automation-timeline-day-head">
                        <strong>{group.label}</strong>
                        <span>{t('{{count}} 个自动化', { count: group.items.length })}</span>
                      </header>
                      <div className="pluse-project-automation-list">
                        {group.items.map((item) => renderAutomationRow(item.quest, automationSectionKey(item.quest), item.runAt))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <p className="pluse-empty-inline">{t('当前项目暂无定时自动化。')}</p>
              )}
            </section>
            {sections.map((section) => (
              <section key={section.key} className={`pluse-project-automation-section is-${section.key}`}>
                <header className="pluse-project-automation-section-head">
                  <div>
                    <span>{section.label}</span>
                    <strong>{section.items.length}</strong>
                  </div>
                  <p>{section.hint}</p>
                </header>
                <div className="pluse-project-automation-list">
                  {section.items.map((quest) => renderAutomationRow(quest, section.key))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <p className="pluse-empty-inline">{t('当前项目暂无自动化。')}</p>
        )}
      </div>
  )

  if (standalone) {
    return (
      <>
        <section className="pluse-project-automation-page">{content}</section>
        <TaskComposerModal
          open={createAutomationOpen}
          projectId={overview.project.id}
          projectName={overview.project.name}
          initialKind="ai"
          onClose={() => setCreateAutomationOpen(false)}
          onCreated={async () => {
            setCreateAutomationOpen(false)
            await onChanged()
          }}
        />
      </>
    )
  }

  return (
    <ProjectCompactSection
      key={`automation-${overview.project.id}`}
      title={t('自动化面板')}
      count={summary.total}
      defaultOpen
      note={healthLabel}
    >
      {content}
    </ProjectCompactSection>
  )
}

function ProjectPage({
  projectId,
  onProjectLoaded,
  onProjectDeleted,
}: {
  projectId: string
  onProjectLoaded: (overview: ProjectOverview) => void
  onProjectDeleted: () => Promise<void>
}) {
  const { locale, t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const [overview, setOverview] = useState<ProjectOverview | null>(null)
  const [tokenSummary, setTokenSummary] = useState<TokenUsageSummary | null>(null)
  const [domains, setDomains] = useState<Domain[]>([])
  const [tab, setTab] = useState<ProjectPageTab>(() => location.hash === '#automation' ? 'automation' : 'overview')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [updatingWaitingTodoId, setUpdatingWaitingTodoId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('')
  const [goal, setGoal] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [domainId, setDomainId] = useState('')
  const [priority, setPriority] = useState<ProjectPriority>('normal')
  const overviewReloadTimerRef = useRef<number | null>(null)
  const pendingOverviewReloadRef = useRef(false)
  const pendingDomainReloadRef = useRef(false)
  const overviewRequestSeqRef = useRef(0)
  const domainsRequestSeqRef = useRef(0)
  const tokenSummaryRequestSeqRef = useRef(0)

  function selectProjectTab(nextTab: ProjectPageTab) {
    setTab(nextTab)
    const nextHash = nextTab === 'automation' ? '#automation' : ''
    if (location.hash === nextHash) return
    navigate({
      pathname: location.pathname,
      search: location.search,
      hash: nextHash,
    }, { replace: true })
  }

  const loadOverview = useCallback(async () => {
    const requestId = overviewRequestSeqRef.current + 1
    overviewRequestSeqRef.current = requestId
    const result = await api.getProjectOverview(projectId)
    if (requestId !== overviewRequestSeqRef.current) return
    if (!result.ok) {
      setError(result.error)
      return
    }
    setOverview(result.data)
    setName(result.data.project.name)
    setIcon(result.data.project.icon ?? '')
    setGoal(result.data.project.goal ?? '')
    setSystemPrompt(result.data.project.systemPrompt ?? '')
    setDomainId(result.data.project.domainId ?? '')
    setPriority(result.data.project.priority)
    setError(null)
    onProjectLoaded(result.data)
  }, [onProjectLoaded, projectId])

  const loadDomains = useCallback(async () => {
    const requestId = domainsRequestSeqRef.current + 1
    domainsRequestSeqRef.current = requestId
    const result = await api.getDomains()
    if (requestId !== domainsRequestSeqRef.current) return
    if (result.ok) setDomains(result.data)
  }, [])

  const loadTokenSummary = useCallback(async () => {
    const requestId = tokenSummaryRequestSeqRef.current + 1
    tokenSummaryRequestSeqRef.current = requestId
    const result = await api.getProjectTokenSummary(projectId)
    if (requestId !== tokenSummaryRequestSeqRef.current) return
    if (result.ok) setTokenSummary(result.data)
  }, [projectId])

  useEffect(() => {
    void loadOverview()
    void loadDomains()
    void loadTokenSummary()
    return () => {
      overviewRequestSeqRef.current += 1
      domainsRequestSeqRef.current += 1
      tokenSummaryRequestSeqRef.current += 1
      if (overviewReloadTimerRef.current) {
        window.clearTimeout(overviewReloadTimerRef.current)
        overviewReloadTimerRef.current = null
      }
      pendingOverviewReloadRef.current = false
      pendingDomainReloadRef.current = false
    }
  }, [loadDomains, loadOverview, loadTokenSummary])

  useEffect(() => {
    if (location.hash === '#automation') setTab('automation')
  }, [location.hash])

  useSseEvent(
    (event) => {
      const shouldReloadOverview = (
        event.type === 'project_updated'
        || event.type === 'reminder_project_priority_updated'
      ) && event.data.projectId === projectId
      const shouldReloadDomains = event.type === 'domain_updated' || event.type === 'domain_deleted'
      if (!shouldReloadOverview && !shouldReloadDomains) return

      if (shouldReloadOverview) pendingOverviewReloadRef.current = true
      if (shouldReloadDomains) pendingDomainReloadRef.current = true
      if (overviewReloadTimerRef.current) window.clearTimeout(overviewReloadTimerRef.current)
      overviewReloadTimerRef.current = window.setTimeout(() => {
        const nextOverviewReload = pendingOverviewReloadRef.current
        const nextDomainReload = pendingDomainReloadRef.current
        pendingOverviewReloadRef.current = false
        pendingDomainReloadRef.current = false

        if (nextOverviewReload) void loadOverview()
        if (nextDomainReload) void loadDomains()
      }, 300)
    },
    {
      onReconnect: () => {
        pendingOverviewReloadRef.current = false
        pendingDomainReloadRef.current = false
        if (overviewReloadTimerRef.current) {
          window.clearTimeout(overviewReloadTimerRef.current)
          overviewReloadTimerRef.current = null
        }
        void loadOverview()
        void loadDomains()
      },
    },
  )

  async function saveProject() {
    setSaving(true)
    const result = await api.updateProject(projectId, { name, icon: icon || null, goal, systemPrompt, domainId: domainId || null, priority })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await loadOverview()
  }

  async function handleWaitingTodoToggle(todo: Todo) {
    setUpdatingWaitingTodoId(todo.id)
    const result = await api.updateTodo(todo.id, { status: todo.status === 'done' ? 'pending' : 'done' })
    setUpdatingWaitingTodoId(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await loadOverview()
  }

  async function handleDeleteProject() {
    if (!overview || deleteConfirmName !== overview.project.name) return
    setDeleting(true)
    const result = await api.deleteProject(projectId)
    setDeleting(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await onProjectDeleted()
    navigate('/')
  }

  if (!overview) {
    return <div className="pluse-page pluse-page-loading">{t('正在加载项目…')}</div>
  }

  const activeDomainName = domains.find((domain) => domain.id === overview.project.domainId)?.name ?? null

  return (
    <div className="pluse-page pluse-project-page">
      <div className="pluse-detail-shell">
        <div className="pluse-project-tabs-bar">
          <div className="pluse-project-tab-group">
            <button
              type="button"
              className={`pluse-project-tab${tab === 'overview' ? ' is-active' : ''}`}
              onClick={() => selectProjectTab('overview')}
            >
              {t('概览')}
            </button>
            <button
              type="button"
              className={`pluse-project-tab${tab === 'automation' ? ' is-active' : ''}`}
              onClick={() => selectProjectTab('automation')}
            >
              {t('自动化')}
            </button>
            <button
              type="button"
              className={`pluse-project-tab${tab === 'settings' ? ' is-active' : ''}`}
              onClick={() => selectProjectTab('settings')}
            >
              {t('设置')}
            </button>
          </div>
          <div className="pluse-project-tab-meta">
            <span className="pluse-project-avatar is-compact" aria-hidden="true">{projectAvatar(overview.project)}</span>
            <span className={`pluse-project-priority-badge is-${overview.project.priority}`}>{projectPriorityLabel(overview.project.priority, t)}</span>
            <span className="pluse-info-path-sm">{shortPath(overview.project.workDir)}</span>
            {activeDomainName ? <span className="pluse-inline-pill">{activeDomainName}</span> : null}
            {overview.project.pinned ? <span className="pluse-inline-pill">{t('固定')}</span> : null}
          </div>
        </div>

        {tab === 'overview' ? (
          <div className="pluse-detail-grid">
            <ProjectOverviewHero overview={overview} tokenSummary={tokenSummary} locale={locale} t={t} />

            {overview.waitingTodos.length > 0 ? (
              <ProjectCompactSection
                key={`waiting-${overview.project.id}`}
                title={t('等待中')}
                count={overview.waitingTodos.length}
                defaultOpen
                note={t('待办')}
                scrollable={overview.waitingTodos.length > 3}
              >
                <div className="pluse-task-list pluse-overview-scroll-list">
                  {overview.waitingTodos.map((todo) => (
                    <WaitingTodoRow
                      key={todo.id}
                      todo={todo}
                      locale={locale}
                      t={t}
                      disabled={updatingWaitingTodoId === todo.id}
                      onToggle={handleWaitingTodoToggle}
                    />
                  ))}
                </div>
              </ProjectCompactSection>
            ) : null}

          </div>
        ) : tab === 'automation' ? (
          <div className="pluse-detail-grid">
            <ProjectAutomationPanel
              overview={overview}
              locale={locale}
              t={t}
              onChanged={loadOverview}
              onError={setError}
              standalone
            />
          </div>
        ) : (
          <div className="pluse-detail-grid">
            <div className="pluse-form-grid">
              <label>
                <span>{t('项目名称')}</span>
                <input value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label>
                <span>{t('项目图标')}</span>
                <input
                  value={icon}
                  onChange={(event) => setIcon(event.target.value.slice(0, 8))}
                  placeholder={t('输入 emoji 或 1-2 个字符')}
                />
              </label>
              <label>
                <span>{t('领域')}</span>
                <select value={domainId} onChange={(event) => setDomainId(event.target.value)}>
                  <option value="">{t('未分组')}</option>
                  {domains.map((domain) => (
                    <option key={domain.id} value={domain.id}>{domain.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t('项目优先级')}</span>
                <select value={priority} onChange={(event) => setPriority(event.target.value as ProjectPriority)}>
                  <option value="mainline">{t('主线')}</option>
                  <option value="priority">{t('优先')}</option>
                  <option value="normal">{t('普通')}</option>
                  <option value="low">{t('低优先')}</option>
                </select>
              </label>
              <label className="pluse-form-span">
                <span>{t('项目目标')}</span>
                <textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={2} />
              </label>
              <label className="pluse-form-span">
                <span>{t('项目 Prompt')}</span>
                <textarea
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  rows={5}
                  placeholder={t('输入项目 Prompt')}
                />
                <p className="pluse-info-copy">{t('仅当前项目生效。全局系统 Prompt 在右上角设置里。')}</p>
              </label>
            </div>
            <div className="pluse-settings-actions">
              <button type="button" className="pluse-button" onClick={() => void saveProject()} disabled={saving}>
                {saving ? t('保存中…') : t('保存')}
              </button>
            </div>
            <div className="pluse-settings-danger-zone">
              <h3>{t('危险操作')}</h3>
              {!confirmDelete ? (
                <button type="button" className="pluse-button pluse-button-danger" onClick={() => setConfirmDelete(true)}>
                  {t('归档项目')}
                </button>
              ) : (
                <div className="pluse-delete-confirm">
                  <p>
                    {t('此操作会将项目及其所有会话、自动化、待办和运行数据归档。请输入项目名称')}
                    {' '}
                    <strong>{overview.project.name}</strong>
                    {' '}
                    {t('确认：')}
                  </p>
                  <input
                    type="text"
                    value={deleteConfirmName}
                    onChange={(event) => setDeleteConfirmName(event.target.value)}
                    placeholder={overview.project.name}
                    autoFocus
                  />
                  <div className="pluse-delete-confirm-actions">
                    <button
                      type="button"
                      className="pluse-button pluse-button-danger"
                      onClick={() => void handleDeleteProject()}
                      disabled={deleting || deleteConfirmName !== overview.project.name}
                    >
                      {deleting ? t('归档中…') : t('确认归档')}
                    </button>
                    <button type="button" className="pluse-button pluse-button-ghost" onClick={() => { setConfirmDelete(false); setDeleteConfirmName('') }}>
                      {t('取消')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {error ? <p className="pluse-error pluse-detail-error">{error}</p> : null}
      </div>
    </div>
  )
}

function QuestRoute({
  onQuestResolved,
  onDataChanged,
}: {
  onQuestResolved: (quest: Quest) => void
  onDataChanged?: () => Promise<void>
}) {
  const { t } = useI18n()
  const location = useLocation()
  const { questId } = useParams()
  const routeState = location.state as QuestRouteState | null
  const stateInitialQuest = routeState?.initialQuest ?? null
  const routeInitialQuest: Quest | null = stateInitialQuest?.id === questId ? stateInitialQuest : null
  const [quest, setQuest] = useState<Quest | null>(() => routeInitialQuest)
  const [error, setError] = useState<string | null>(null)
  const isOverlay = Boolean(routeState?.backgroundLocation)

  useEffect(() => {
    if (!questId) return
    if (routeInitialQuest) {
      setQuest(routeInitialQuest)
      setError(null)
      onQuestResolved(routeInitialQuest)
      if (routeInitialQuest.unread) {
        void api.updateQuest(questId, { unread: false })
      }
      return
    }
    setQuest(null)
    void api.getQuest(questId).then((result) => {
      if (!result.ok) {
        setError(result.error)
        return
      }
      setQuest(result.data)
      onQuestResolved(result.data)
      setError(null)
      if (result.data.unread) {
        void api.updateQuest(questId, { unread: false })
      }
    })
  }, [questId, onQuestResolved, routeInitialQuest])

  const handleQuestLoaded = useCallback((nextQuest: Quest) => {
    setQuest(nextQuest)
    onQuestResolved(nextQuest)
  }, [onQuestResolved])

  if (!questId) return <Navigate to="/" replace />
  if (error) {
    return isOverlay ? (
      <div className="pluse-modal-backdrop pluse-task-detail-backdrop">
        <section className="pluse-modal-panel pluse-task-detail-modal">
          <div className="pluse-task-detail-loading">
            <p className="pluse-empty-inline">{t('加载失败：{error}', { error })}</p>
          </div>
        </section>
      </div>
    ) : <div className="pluse-page pluse-page-loading">{t('加载失败：{error}', { error })}</div>
  }
  if (!quest) {
    return isOverlay ? (
      <div className="pluse-modal-backdrop pluse-task-detail-backdrop">
        <section className="pluse-modal-panel pluse-task-detail-modal">
          <div className="pluse-task-detail-loading">
            <p className="pluse-empty-inline">{t('正在加载自动化…')}</p>
          </div>
        </section>
      </div>
    ) : <div className="pluse-page pluse-page-loading">{t('正在加载内容…')}</div>
  }

  const fallback = isOverlay ? (
    <div className="pluse-modal-backdrop pluse-task-detail-backdrop">
      <section className="pluse-modal-panel pluse-task-detail-modal">
        <div className="pluse-task-detail-loading">
          <p className="pluse-empty-inline">{t('正在加载内容…')}</p>
        </div>
      </section>
    </div>
  ) : <RouteLoading message={t('正在加载内容…')} />

  // Sessions don't support overlay mode — navigate directly as a full page
  if (isOverlay && quest.kind === 'session') {
    return <Navigate to={`/quests/${questId}`} replace state={null} />
  }

  return (
    <Suspense fallback={fallback}>
      {quest.kind === 'task'
        ? <TaskDetail questId={questId} initialQuest={quest} onQuestLoaded={handleQuestLoaded} onDataChanged={onDataChanged} />
        : <ChatView questId={questId} initialQuest={quest} onQuestLoaded={handleQuestLoaded} onDataChanged={onDataChanged} />}
    </Suspense>
  )
}

function WorkspaceHeader(props: {
  activeProject: Project | null
  activeQuest: Quest | null
  theme: ThemeMode
  title?: string
  subtitle?: string | null
  floating?: boolean
  overlayOpen?: boolean
  hideContext?: boolean
  sidebarVisible: boolean
  railVisible: boolean
  showSidebarToggle: boolean
  showRailToggle: boolean
  showSettingsToggle: boolean
  onToggleTheme: () => void
  onToggleSidebar: () => void
  onToggleRail: () => void
  onOpenSettings: () => void
  onOpenWorkspace: () => void
}) {
  const { locale, setLocale, t } = useI18n()
  const title = props.title ?? (props.activeQuest
    ? questLabel(props.activeQuest, t)
    : props.activeProject?.name || 'Pluse')
  const subtitle = props.subtitle ?? (props.activeQuest
    ? props.activeQuest.kind === 'task'
      ? formatOutputStatus(props.activeQuest.status ?? 'idle', t)
      : [
          props.activeQuest.activeRunId ? t('运行中') : null,
          props.activeQuest.followUpQueue.length > 0 ? t('待发送 {count}', { count: props.activeQuest.followUpQueue.length }) : null,
        ].filter(Boolean).join(' · ') || null
    : props.activeProject?.workDir
      ? shortPath(props.activeProject.workDir)
      : null)

  return (
    <header className={`pluse-header${props.floating ? ' is-floating' : ''}${props.overlayOpen ? ' has-panel-overlay' : ''}`}>
      <div className="pluse-header-primary">
        <button
          type="button"
          className="pluse-icon-button pluse-mobile-only"
          onClick={props.onToggleSidebar}
          aria-label={t('打开侧栏')}
          title={t('打开侧栏')}
        >
          <MenuIcon className="pluse-icon" />
        </button>
        <button type="button" className="pluse-wordmark" onClick={props.onOpenWorkspace}>
          <span>Pluse</span>
        </button>
      </div>

      <div className="pluse-header-center">
        {!props.hideContext ? (
          <div className="pluse-header-context">
            <strong>{title}</strong>
            {subtitle ? <span>{subtitle}</span> : null}
          </div>
        ) : null}
      </div>

      <div className="pluse-header-actions">
        <span className="pluse-header-presence" aria-hidden="true" />
        <button
          type="button"
          className="pluse-button pluse-button-ghost pluse-button-compact pluse-header-locale-toggle"
          onClick={() => setLocale(nextLocale(locale))}
          aria-label={t('切换语言')}
          title={t('切换语言')}
        >
          <span className="pluse-header-locale-label-desktop">{localeLabel(nextLocale(locale))}</span>
          <span className="pluse-header-locale-label-mobile">{nextLocale(locale) === 'zh-CN' ? '中' : 'EN'}</span>
        </button>
        <button
          type="button"
          className="pluse-icon-button pluse-header-action-icon pluse-theme-toggle"
          onClick={props.onToggleTheme}
          aria-label={props.theme === 'dark' ? t('切换到浅色模式') : t('切换到深色模式')}
          title={props.theme === 'dark' ? t('切换到浅色模式') : t('切换到深色模式')}
        >
          {props.theme === 'dark' ? <SunIcon className="pluse-icon" /> : <MoonIcon className="pluse-icon" />}
        </button>
        {props.showSettingsToggle ? (
          <button
            type="button"
            className="pluse-icon-button pluse-header-action-icon"
            onClick={props.onOpenSettings}
            aria-label={t('打开设置')}
            title={t('设置')}
          >
            <SlidersIcon className="pluse-icon" />
          </button>
        ) : null}
        {props.showSidebarToggle ? (
          <button
            type="button"
            className={`pluse-icon-button pluse-header-action-icon${props.sidebarVisible ? ' is-active' : ''}`}
            onClick={props.onToggleSidebar}
            aria-label={t('切换侧栏')}
            title={t('切换侧栏')}
          >
            <SidebarIcon className="pluse-icon" />
          </button>
        ) : null}
        {props.showRailToggle ? (
          <button
            type="button"
            className={`pluse-icon-button pluse-header-action-icon pluse-header-rail-toggle${props.railVisible ? ' is-active' : ''}`}
            onClick={props.onToggleRail}
            aria-label={t('切换工作台')}
            title={t('切换工作台')}
          >
            <RailIcon className="pluse-icon" />
          </button>
        ) : null}
      </div>
    </header>
  )
}

function Shell({
  auth,
  theme,
  onToggleTheme,
}: {
  auth: AuthMe
  theme: ThemeMode
  onToggleTheme: () => void
}) {
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const locationPathRef = useRef(location.pathname)
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [activeQuest, setActiveQuest] = useState<Quest | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' ? window.innerWidth >= 861 : true)
  const [desktopSidebarVisible, setDesktopSidebarVisible] = useState(true)
  const [desktopRailVisible, setDesktopRailVisible] = useState(true)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [mobileRailOpen, setMobileRailOpen] = useState(false)
  const projectsReloadTimerRef = useRef<number | null>(null)

  const activeQuestId = activeQuest?.id ?? (location.pathname.startsWith('/quests/') ? location.pathname.split('/')[2] : null)
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  )

  const isQuestRoute = location.pathname.startsWith('/quests/')
  const isProjectRoute = location.pathname.startsWith('/projects/')
  const isSettingsRoute = location.pathname === '/settings'
  const routeState = location.state as QuestRouteState | null
  const backgroundLocation = routeState?.backgroundLocation ?? null
  const showRail = Boolean(activeProjectId)
  const sidebarVisible = isDesktop ? desktopSidebarVisible : mobileSidebarOpen
  const railVisible = showRail && (isDesktop ? desktopRailVisible : mobileRailOpen)
  const isSessionRoute = activeQuest?.kind === 'session'

  useEffect(() => {
    locationPathRef.current = location.pathname
  }, [location.pathname])

  const loadProjects = useCallback(async () => {
    const result = await api.getProjects()
    if (!result.ok) {
      setLoadError(result.error)
      return
    }
    setLoadError(null)
    setProjects(result.data)

    setActiveProjectId((current) => {
      if (current && result.data.some((project) => project.id === current)) {
        return current
      }
      return result.data[0]?.id ?? null
    })

    if (locationPathRef.current === '/' && result.data[0]) {
      const projectId = result.data[0].id
      void getPreferredSession(projectId).then((quest) => {
        if (locationPathRef.current !== '/') return
        navigate(
          quest ? `/quests/${quest.id}` : `/projects/${projectId}`,
          quest ? { replace: true, state: { initialQuest: quest } } : { replace: true },
        )
      })
    }
  }, [navigate])

  const handleOverviewChanged = useCallback(async () => {
    return
  }, [])

  const handleProjectOverviewLoaded = useCallback((overview: ProjectOverview) => {
    setActiveProjectId(overview.project.id)
    setActiveQuest(null)
    setProjects((current) => {
      const exists = current.some((project) => project.id === overview.project.id)
      if (!exists) return [...current, overview.project]
      return current.map((project) => project.id === overview.project.id ? overview.project : project)
    })
  }, [])

  const handleQuestResolved = useCallback((quest: Quest) => {
    setActiveProjectId(quest.projectId)
    setActiveQuest(quest)
    if (quest.kind === 'session') {
      rememberLastSession(quest.projectId, quest.id)
    }
  }, [])

  const handleProjectSelected = useCallback((projectId: string) => {
    setActiveProjectId(projectId)
  }, [])

  useEffect(() => {
    void loadProjects().finally(() => setLoading(false))
  }, [loadProjects])

  useEffect(() => {
    setMobileSidebarOpen(false)
    setMobileRailOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const hasOverlay = mobileSidebarOpen || mobileRailOpen
    document.body.classList.toggle('pluse-overlay-open', hasOverlay)
    return () => document.body.classList.remove('pluse-overlay-open')
  }, [mobileSidebarOpen, mobileRailOpen])

  useEffect(() => {
    const media = window.matchMedia('(min-width: 861px)')
    const update = () => setIsDesktop(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    return () => {
      if (projectsReloadTimerRef.current) {
        window.clearTimeout(projectsReloadTimerRef.current)
        projectsReloadTimerRef.current = null
      }
    }
  }, [])

  useSseEvent(
    (event) => {
      if (
        event.type !== 'project_opened'
        && event.type !== 'project_updated'
        && event.type !== 'reminder_project_priority_updated'
      ) return
      if (projectsReloadTimerRef.current) window.clearTimeout(projectsReloadTimerRef.current)
      projectsReloadTimerRef.current = window.setTimeout(() => {
        void loadProjects()
      }, 300)
    },
    {
      onReconnect: () => {
        if (projectsReloadTimerRef.current) {
          window.clearTimeout(projectsReloadTimerRef.current)
          projectsReloadTimerRef.current = null
        }
        void loadProjects()
      },
    },
  )

  if (!auth.authenticated) {
    return <Navigate to="/login" replace />
  }

  if (loading) return <div className="pluse-loading">{t('正在加载 Pluse…')}</div>
  if (loadError) return (
    <div className="pluse-loading">
      <p>{t('加载失败：{error}', { error: loadError })}</p>
      <button type="button" className="pluse-button" onClick={() => { void loadProjects() }}>{t('重试')}</button>
    </div>
  )

  return (
    <div className="pluse-app-shell">
      <WorkspaceHeader
        activeProject={activeProject}
        activeQuest={activeQuest}
        theme={theme}
        title={isSettingsRoute ? t('设置') : undefined}
        subtitle={isSettingsRoute ? t('全局系统 Prompt') : undefined}
        floating={!isDesktop && isQuestRoute && isSessionRoute}
        overlayOpen={!isDesktop && (mobileSidebarOpen || mobileRailOpen)}
        hideContext={!isDesktop && (mobileSidebarOpen || mobileRailOpen)}
        sidebarVisible={sidebarVisible}
        railVisible={railVisible}
        showSidebarToggle={isDesktop}
        showRailToggle={showRail}
        showSettingsToggle={!isSettingsRoute}
        onToggleTheme={onToggleTheme}
        onToggleSidebar={() => {
          if (isDesktop) setDesktopSidebarVisible((value) => !value)
          else setMobileSidebarOpen((value) => !value)
        }}
        onToggleRail={() => {
          if (isDesktop) setDesktopRailVisible((value) => !value)
          else setMobileRailOpen((value) => !value)
        }}
        onOpenSettings={() => navigate('/settings')}
        onOpenWorkspace={() => {
          if (!activeProjectId) {
            navigate('/')
            return
          }
          void getPreferredSession(activeProjectId).then((quest) => {
            navigate(
              quest ? `/quests/${quest.id}` : `/projects/${activeProjectId}`,
              quest ? { state: { initialQuest: quest } } : undefined,
            )
          })
        }}
      />

      <div
        className={`pluse-workspace${isProjectRoute ? ' is-project-route' : ''}${isQuestRoute && isSessionRoute ? ' is-session-route' : ''}`}
        style={isDesktop
          ? {
              gridTemplateColumns: showRail
                ? `${desktopSidebarVisible ? 'var(--sidebar-width)' : '0px'} minmax(0, 1fr) ${desktopRailVisible ? 'var(--rail-width)' : '0px'}`
                : `${desktopSidebarVisible ? 'var(--sidebar-width)' : '0px'} minmax(0, 1fr)`,
            }
          : undefined}
      >
        <button
          type="button"
          className={`pluse-backdrop${mobileSidebarOpen || mobileRailOpen ? ' is-visible' : ''}`}
          onClick={() => {
            setMobileSidebarOpen(false)
            setMobileRailOpen(false)
          }}
          aria-label={t('关闭面板')}
          title={t('关闭面板')}
        />

        <div className={`pluse-sidebar-shell${sidebarVisible ? ' is-open' : ''}${isDesktop && !desktopSidebarVisible ? ' is-hidden' : ''}`}>
          <SessionList
            projects={projects}
            activeProjectId={activeProjectId}
            activeQuestId={activeQuestId}
            onSelectProject={handleProjectSelected}
            onProjectsChanged={loadProjects}
            onOverviewChanged={handleOverviewChanged}
            onNavigate={() => setMobileSidebarOpen(false)}
            onRequestClose={() => setMobileSidebarOpen(false)}
          />
        </div>

        <main className="pluse-main-shell">
          <div className="pluse-main">
            <Routes location={backgroundLocation || location}>
              <Route path="/" element={<RouteLoading message={t('正在加载项目…')} />} />
              <Route
                path="/projects/:projectId"
                element={
                  <ProjectRoute
                    onOverviewLoaded={handleProjectOverviewLoaded}
                    onProjectDeleted={loadProjects}
                  />
                }
              />
              <Route
                path="/settings"
                element={(
                  <Suspense fallback={<RouteLoading message={t('正在加载设置…')} />}>
                    <SettingsPage />
                  </Suspense>
                )}
              />
              <Route
                path="/quests/:questId"
                element={
                  <QuestRoute
                    onQuestResolved={handleQuestResolved}
                  />
                }
              />
            </Routes>

            {backgroundLocation ? (
              <Routes>
                <Route
                  path="/quests/:questId"
                  element={
                    <QuestRoute
                      onQuestResolved={handleQuestResolved}
                    />
                  }
                />
              </Routes>
            ) : null}
          </div>
        </main>

        {showRail ? (
          <div className={`pluse-rail-shell${railVisible ? ' is-open' : ''}${isDesktop && !desktopRailVisible ? ' is-hidden' : ''}`}>
            <TodoPanel
              projectId={activeProjectId}
              projectName={activeProject?.name ?? null}
              projects={projects}
              activeQuestId={activeQuestId}
              onRequestClose={() => setMobileRailOpen(false)}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ProjectRoute({
  onOverviewLoaded,
  onProjectDeleted,
}: {
  onOverviewLoaded: (overview: ProjectOverview) => void
  onProjectDeleted: () => Promise<void>
}) {
  const { projectId } = useParams()
  if (!projectId) return <Navigate to="/" replace />
  return <ProjectPage projectId={projectId} onProjectLoaded={onOverviewLoaded} onProjectDeleted={onProjectDeleted} />
}

export function MainPage() {
  const { t } = useI18n()
  const [auth, setAuth] = useState<AuthMe | null>(null)
  const [theme, setTheme] = useState<ThemeMode>(resolveInitialTheme)

  useEffect(() => {
    void api.getAuthMe().then((result) => {
      if (result.ok) setAuth(result.data)
      else setAuth({ authenticated: false, setupRequired: true })
    })
  }, [])

  useEffect(() => {
    applyTheme(theme)
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  if (!auth) return <div className="pluse-loading">{t('正在加载 Pluse…')}</div>

  return (
    <Routes>
      <Route
        path="/login"
        element={
          auth.authenticated
            ? <Navigate to="/" replace />
            : <LoginPage setupRequired={auth.setupRequired} onAuthenticated={setAuth} theme={theme} onToggleTheme={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} />
        }
      />
      <Route path="/*" element={<Shell auth={auth} theme={theme} onToggleTheme={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} />} />
    </Routes>
  )
}
