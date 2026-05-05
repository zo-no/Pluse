import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { Project, Quest } from '@pluse/types'
import * as api from '@/api/client'
import { useI18n } from '@/i18n'
import { useSseEvent } from '@/views/hooks/useSseEvent'
import { displayQuestName } from '@/views/utils/display'
import { ArchiveIcon, ClockIcon, PauseIcon, PlayIcon, PlusIcon, RouteIcon, SparkIcon } from './icons'
import { TaskComposerModal } from './TaskComposerModal'

interface AutomationRailPanelProps {
  projectId: string | null
  projectName?: string | null
  projects: Project[]
  activeQuestId?: string | null
  onRequestClose?: () => void
  /** 嵌入 ContextWorkbench 时为 true，跳过外层 aside 和头部，只渲染内容区 */
  hideHeader?: boolean
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

function formatDateTime(value?: string, locale = 'zh-CN', t?: (key: string) => string): string {
  if (!value) return t ? t('未记录') : '未记录'
  return new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function automationNextRunAt(quest: Quest): string | undefined {
  return quest.scheduleConfig?.nextRunAt
    ?? (quest.scheduleKind === 'scheduled' ? quest.scheduleConfig?.runAt : undefined)
}

function isAutomationRunning(quest: Quest): boolean {
  return Boolean(quest.activeRunId) || quest.status === 'running'
}

function automationTimeLabel(
  quest: Quest,
  locale: string,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (isAutomationRunning(quest)) return t('运行中')
  if (quest.enabled === false) return t('已暂停')
  const nextRunAt = automationNextRunAt(quest)
  if (nextRunAt) return t('下次 {{time}}', { time: formatDateTime(nextRunAt, locale, t) })
  if (quest.scheduleConfig?.lastRunAt) return t('最近 {{time}}', { time: formatDateTime(quest.scheduleConfig.lastRunAt, locale, t) })
  if (quest.scheduleKind === 'once' || !quest.scheduleKind) return t('手动')
  return formatSidebarTime(quest.updatedAt, t)
}

function formatOutputStatus(status: string, t?: (key: string) => string): string {
  const normalized = status.toLowerCase()
  if (normalized === 'completed' || normalized === 'done') return t ? t('已完成') : '已完成'
  if (normalized === 'running') return t ? t('运行中') : '运行中'
  if (normalized === 'failed') return t ? t('失败') : '失败'
  if (normalized === 'cancelled') return t ? t('已取消') : '已取消'
  if (normalized === 'pending') return t ? t('待处理') : '待处理'
  if (normalized === 'idle') return t ? t('空闲') : '空闲'
  return status
}

function taskOverlayState(location: ReturnType<typeof useLocation>): { backgroundLocation: ReturnType<typeof useLocation> } {
  const existingBackground = (location.state as { backgroundLocation?: ReturnType<typeof useLocation> } | null)?.backgroundLocation
  return { backgroundLocation: existingBackground ?? location }
}

const AutomationRow = memo(function AutomationRow({
  quest,
  active,
  busy,
  locale,
  t,
  questLinkState,
  onTrigger,
  onToggle,
  onArchive,
  onNavigate,
}: {
  quest: Quest
  active: boolean
  busy: boolean
  locale: string
  t: (key: string, values?: Record<string, string | number>) => string
  questLinkState: { backgroundLocation: ReturnType<typeof useLocation> }
  onTrigger: (quest: Quest) => void
  onToggle: (quest: Quest) => void
  onArchive: (quest: Quest) => void
  onNavigate?: () => void
}) {
  const isPaused = quest.enabled === false
  const canTrigger = !busy && !quest.activeRunId && quest.enabled !== false
  const statusKey = quest.activeRunId ? 'running' : quest.status ?? 'pending'

  return (
    <article
      className={`pluse-sidebar-item pluse-sidebar-row pluse-task-list-item is-automation${active ? ' is-active' : ''}${isPaused ? ' is-paused' : ''}`}
    >
      <Link
        className="pluse-task-list-main pluse-sidebar-item-main"
        to={`/quests/${quest.id}`}
        state={{ ...questLinkState, initialQuest: quest }}
        onClick={onNavigate}
        aria-label={`${t('自动化')} · ${displayQuestName(quest, t)}`}
      >
        <div className="pluse-task-list-copy">
          <div className="pluse-sidebar-item-title">
            <SparkIcon className="pluse-icon pluse-sidebar-leading-icon" />
            <strong>{displayQuestName(quest, t)}</strong>
          </div>
          <div className="pluse-task-list-meta">
            <span className={`pluse-task-list-state is-${statusKey}`}>
              {quest.activeRunId ? t('运行中') : isPaused ? t('已暂停') : quest.scheduleKind === 'recurring' ? t('周期') : quest.scheduleKind === 'scheduled' ? t('定时') : t('手动')}
            </span>
            <span className="pluse-task-list-dot" aria-hidden="true">·</span>
            <span className="pluse-meta-inline">
              <ClockIcon className="pluse-icon pluse-inline-icon" />
              {automationTimeLabel(quest, locale, t)}
            </span>
          </div>
        </div>
      </Link>
      <div className="pluse-sidebar-item-actions">
        <button
          type="button"
          className="pluse-sidebar-action-btn"
          onClick={() => onTrigger(quest)}
          aria-label={t('立即触发')}
          title={t('立即触发')}
          disabled={!canTrigger}
        >
          <PlayIcon className="pluse-icon" />
        </button>
        <button
          type="button"
          className="pluse-sidebar-action-btn"
          onClick={() => onToggle(quest)}
          aria-label={isPaused ? t('恢复自动化') : t('暂停自动化')}
          title={isPaused ? t('恢复自动化') : t('暂停自动化')}
          disabled={busy}
        >
          {isPaused ? <PlayIcon className="pluse-icon" /> : <PauseIcon className="pluse-icon" />}
        </button>
        <button
          type="button"
          className="pluse-sidebar-action-btn"
          onClick={() => onArchive(quest)}
          aria-label={t('归档')}
          title={t('归档')}
          disabled={busy}
        >
          <ArchiveIcon className="pluse-icon" />
        </button>
      </div>
    </article>
  )
})

export function AutomationRailPanel({
  projectId,
  projectName,
  activeQuestId,
  onRequestClose,
  hideHeader = false,
}: AutomationRailPanelProps) {
  const { locale, t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const [automations, setAutomations] = useState<Quest[]>([])
  const [busyQuestId, setBusyQuestId] = useState<string | null>(null)
  const [createAutomationOpen, setCreateAutomationOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const reloadTimerRef = useRef<number | null>(null)
  const pendingReloadRef = useRef(false)
  const dataRequestSeqRef = useRef(0)

  const loadData = useCallback(async () => {
    if (!projectId) {
      setAutomations([])
      return
    }
    const requestId = dataRequestSeqRef.current + 1
    dataRequestSeqRef.current = requestId
    const result = await api.getQuests({ projectId, kind: 'task', deleted: false })
    if (requestId !== dataRequestSeqRef.current) return
    if (result.ok) setAutomations(result.data)
  }, [projectId])

  useEffect(() => {
    void loadData()
    return () => {
      dataRequestSeqRef.current += 1
    }
  }, [loadData, reloadTick])

  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) {
        window.clearTimeout(reloadTimerRef.current)
        reloadTimerRef.current = null
      }
      pendingReloadRef.current = false
    }
  }, [])

  useSseEvent(
    (event) => {
      const shouldReload = (
        event.type === 'quest_updated'
        || event.type === 'quest_deleted'
        || event.type === 'run_updated'
      ) && (event.data as { projectId?: string }).projectId === projectId
      if (!shouldReload) return

      pendingReloadRef.current = true
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current)
      reloadTimerRef.current = window.setTimeout(() => {
        pendingReloadRef.current = false
        setReloadTick((v) => v + 1)
      }, 300)
    },
    {
      onReconnect: () => {
        pendingReloadRef.current = false
        if (reloadTimerRef.current) {
          window.clearTimeout(reloadTimerRef.current)
          reloadTimerRef.current = null
        }
        void loadData()
      },
    },
  )

  const questLinkState = useMemo(() => taskOverlayState(location), [location])

  async function waitForQuestRunCleared(questId: string): Promise<boolean> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const current = await api.getQuest(questId)
      if (current.ok && !current.data.activeRunId) return true
      await new Promise((resolve) => window.setTimeout(resolve, 150))
    }
    return false
  }

  async function handleTrigger(quest: Quest) {
    setBusyQuestId(quest.id)
    setError(null)
    try {
      const result = await api.startQuestRun(quest.id, { trigger: 'manual', triggeredBy: 'human' })
      if (!result.ok) {
        setError(result.error)
        return
      }
      await loadData()
    } finally {
      setBusyQuestId(null)
    }
  }

  async function handleToggle(quest: Quest) {
    const nextEnabled = quest.enabled === false
    setBusyQuestId(quest.id)
    setError(null)
    try {
      if (!nextEnabled && quest.activeRunId) {
        const confirmed = window.confirm(t('当前任务正在运行，停用前会先取消当前执行。继续吗？'))
        if (!confirmed) return
        const cancelled = await api.cancelRun(quest.activeRunId)
        if (!cancelled.ok) {
          setError(cancelled.error)
          return
        }
        const cleared = await waitForQuestRunCleared(quest.id)
        if (!cleared) {
          setError(t('当前执行尚未完全停止，请稍后再试'))
          return
        }
      }
      const result = await api.updateQuest(quest.id, { enabled: nextEnabled })
      if (!result.ok) {
        setError(result.error)
        return
      }
      await loadData()
    } finally {
      setBusyQuestId(null)
    }
  }

  async function handleArchive(quest: Quest) {
    setBusyQuestId(quest.id)
    setError(null)
    try {
      if (quest.activeRunId) {
        const confirmed = window.confirm(t('当前任务正在运行，归档前会先取消当前执行。继续吗？'))
        if (!confirmed) return
        const cancelled = await api.cancelRun(quest.activeRunId)
        if (!cancelled.ok) {
          setError(cancelled.error)
          return
        }
        const cleared = await waitForQuestRunCleared(quest.id)
        if (!cleared) {
          setError(t('当前执行尚未完全停止，请稍后再试'))
          return
        }
      }
      const result = await api.updateQuest(quest.id, { deleted: true })
      if (!result.ok) {
        setError(result.error)
        return
      }
      await loadData()
    } finally {
      setBusyQuestId(null)
    }
  }

  const runningCount = automations.filter(isAutomationRunning).length
  const attentionCount = automations.filter((q) => q.status === 'failed' || q.status === 'cancelled').length

  const automationContent = (
    <>
      {runningCount > 0 || attentionCount > 0 ? (
        <div className="pluse-automation-rail-status">
          {runningCount > 0 ? (
            <span className="pluse-automation-rail-status-chip is-running">
              {t('运行中')} {runningCount}
            </span>
          ) : null}
          {attentionCount > 0 ? (
            <span className="pluse-automation-rail-status-chip is-attention">
              {t('需关注')} {attentionCount}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="pluse-task-list">
        {automations.length === 0 ? (
          <div className="pluse-rail-empty pluse-task-empty-state">
            <strong>{t('暂无自动化')}</strong>
            <p>{t('当前项目还没有自动化任务。')}</p>
          </div>
        ) : (
          <div className="pluse-note-list">
            {automations.map((quest) => (
              <AutomationRow
                key={quest.id}
                quest={quest}
                active={quest.id === activeQuestId}
                busy={busyQuestId === quest.id}
                locale={locale}
                t={t}
                questLinkState={questLinkState}
                onTrigger={handleTrigger}
                onToggle={handleToggle}
                onArchive={handleArchive}
                onNavigate={onRequestClose}
              />
            ))}
          </div>
        )}
      </div>

      <section className="pluse-rail-section-new-task">
        <button
          type="button"
          className="pluse-sidebar-chip-link pluse-sidebar-new-session-card pluse-rail-new-task-card"
          onClick={() => setCreateAutomationOpen(true)}
          aria-label={t('新建自动化')}
          disabled={!projectId}
        >
          <PlusIcon className="pluse-icon" />
          <span>{t('新建自动化')}</span>
        </button>
      </section>

      {error ? <p className="pluse-error" style={{ padding: '0 10px 10px' }}>{error}</p> : null}

      <TaskComposerModal
        open={createAutomationOpen}
        projectId={projectId}
        projectName={projectName}
        initialKind="ai"
        onClose={() => setCreateAutomationOpen(false)}
        onCreated={async () => {
          setCreateAutomationOpen(false)
          await loadData()
        }}
      />
    </>
  )

  // 嵌入工作台时只渲染内容区
  if (hideHeader) {
    return automationContent
  }

  return (
    <>
      <aside className="pluse-rail pluse-automation-rail">
        <div className="pluse-rail-head pluse-rail-head-sidebar">
          <div className="pluse-sidebar-project-context pluse-workbench-project-context">
            <div className="pluse-workbench-project-strip">
              <div className="pluse-workbench-project-copy">
                <strong>{projectName || t('当前项目')}</strong>
              </div>
            </div>
          </div>
          <div className="pluse-sidebar-tabs pluse-sidebar-tabs-vertical pluse-rail-object-tabs" role="tablist" aria-label={t('自动化')}>
            <button
              type="button"
              className="pluse-sidebar-tab pluse-rail-object-tab is-active"
              aria-selected
            >
              {t('自动化')}
              {automations.length > 0 ? <span className="pluse-tab-count">{automations.length}</span> : null}
            </button>
          </div>
          <div className="pluse-rail-content-divider" aria-hidden="true" />
        </div>
        {automationContent}
      </aside>
    </>
  )
}
