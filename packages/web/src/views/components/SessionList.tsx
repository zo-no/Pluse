import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Project, Quest } from '@pluse/types'
import * as api from '@/api/client'
import { useI18n } from '@/i18n'
import { displayQuestName } from '@/views/utils/display'
import { parseSseMessage } from '@/views/utils/sse'
import { ArchiveIcon, ClockIcon, CloseIcon, PinIcon, PlusIcon, SettingsIcon, SlidersIcon } from './icons'

interface SessionListProps {
  projects: Project[]
  activeProjectId: string | null
  activeQuestId: string | null
  onSelectProject: (projectId: string) => void
  onProjectsChanged: () => Promise<void>
  onOverviewChanged?: (projectId?: string) => Promise<void>
  onNavigate?: () => void
  onRequestClose?: () => void
}

function shortPath(value?: string | null): string {
  if (!value) return ''
  const normalized = value.replace(/^\/Users\/[^/]+/, '~')
  const isHome = normalized.startsWith('~/')
  const parts = normalized.replace(/^~\//, '').replace(/^\//, '').split('/').filter(Boolean)
  if (parts.length <= 3) return normalized
  return `${isHome ? '~/' : '/'}${parts.slice(0, 2).join('/')}/…/${parts.slice(-2).join('/')}`
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

function formatSidebarAbsoluteTime(value?: string, locale = 'zh-CN'): string {
  if (!value) return ''
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatArchiveDateLabel(
  value?: string,
  locale = 'zh-CN',
  t?: (key: string) => string,
): string {
  if (!value) return t ? t('未记录日期') : '未记录日期'
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(value))
}

function questLabel(quest: Quest, t?: (key: string) => string): string {
  return displayQuestName(quest, t)
}

function getSessionPresenceState(quest: Quest, activeQuestId: string | null): 'running' | 'complete' | null {
  if (quest.activeRunId) return 'running'
  if (quest.completionOutput && activeQuestId !== quest.id) return 'complete'
  return null
}

export function SessionList({
  projects,
  activeProjectId,
  activeQuestId,
  onSelectProject,
  onProjectsChanged,
  onOverviewChanged,
  onNavigate,
  onRequestClose,
}: SessionListProps) {
  const { locale, t } = useI18n()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<Quest[]>([])
  const [archivedSessions, setArchivedSessions] = useState<Quest[]>([])
  const [archivedSessionsExpanded, setArchivedSessionsExpanded] = useState(false)
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projectDir, setProjectDir] = useState('')
  const [projectGoal, setProjectGoal] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  )
  const nextSessionIdAfterDelete = useCallback((questId: string): string | null => {
    const index = sessions.findIndex((quest) => quest.id === questId)
    if (index === -1) return null
    const nextQuest = sessions[index + 1] || sessions[index - 1]
    return nextQuest ? nextQuest.id : null
  }, [sessions])
  const knownQuests = useMemo(
    () => [...sessions, ...archivedSessions],
    [sessions, archivedSessions],
  )

  const loadQuests = useCallback(async () => {
    if (!activeProjectId) {
      setSessions([])
      setArchivedSessions([])
      return
    }

    const [sessionResult, archivedSessionResult] = await Promise.all([
      api.getQuests({ projectId: activeProjectId, kind: 'session', deleted: false }),
      api.getQuests({ projectId: activeProjectId, kind: 'session', deleted: true }),
    ])

    if (sessionResult.ok) setSessions(sessionResult.data)
    if (archivedSessionResult.ok) setArchivedSessions(archivedSessionResult.data)
  }, [activeProjectId])

  useEffect(() => {
    void loadQuests()
  }, [loadQuests])

  useEffect(() => {
    if (!activeProjectId) return
    const source = new EventSource(`/api/events?projectId=${encodeURIComponent(activeProjectId)}`)
    let reloadTimer: number | null = null
    source.onmessage = (message) => {
      const event = parseSseMessage(message.data)
      if (!event) return
      if (event.type !== 'quest_updated' && event.type !== 'quest_deleted') return
      if (reloadTimer) window.clearTimeout(reloadTimer)
      reloadTimer = window.setTimeout(() => {
        void loadQuests()
      }, 120)
    }
    source.onerror = () => source.close()
    return () => {
      source.close()
      if (reloadTimer) window.clearTimeout(reloadTimer)
    }
  }, [activeProjectId, loadQuests])

  useEffect(() => {
    if (!projectPickerOpen) return
    function handleClick(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setProjectPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [projectPickerOpen])

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  async function handleCreateProject(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const result = await api.openProject({
      name: projectName || undefined,
      workDir: projectDir,
      goal: projectGoal || undefined,
    })
    if (!result.ok) {
      setError(result.error)
      return
    }

    setProjectName('')
    setProjectDir('')
    setProjectGoal('')
    setNewProjectOpen(false)
    setProjectPickerOpen(false)
    await onProjectsChanged()
    onNavigate?.()
    navigate(`/projects/${result.data.id}`)
  }

  function handleSelectProject(projectId: string) {
    onSelectProject(projectId)
    setProjectPickerOpen(false)
    setNewProjectOpen(false)
    onNavigate?.()
    navigate(`/projects/${projectId}`)
  }

  async function handleCreateQuest(kind: Quest['kind']) {
    if (!activeProjectId) return
    const result = await api.createQuest(
      kind === 'session'
        ? {
            projectId: activeProjectId,
            kind,
            createdBy: 'human',
            tool: 'codex',
            name: t('新会话'),
            autoRenamePending: true,
          }
        : {
            projectId: activeProjectId,
            kind,
            createdBy: 'human',
            tool: 'codex',
            title: t('新任务'),
            status: 'pending',
            enabled: true,
            scheduleKind: 'once',
            executorKind: 'ai_prompt',
            executorConfig: { prompt: '' },
            executorOptions: { continueQuest: true },
          },
    )
    if (!result.ok) {
      setError(result.error)
      return
    }

    await loadQuests()
    await onOverviewChanged?.(activeProjectId)
    onNavigate?.()
    navigate(`/quests/${result.data.id}`)
  }

  async function handleRename(questId: string, nextName: string) {
    setRenamingId(null)
    const quest = knownQuests.find((item) => item.id === questId)
    if (!quest || !nextName.trim()) return
    const result = await api.updateQuest(questId, quest.kind === 'session'
      ? { name: nextName.trim() }
      : { title: nextName.trim() })
    if (!result.ok) {
      setError(result.error)
      return
    }
    await loadQuests()
    await onOverviewChanged?.(activeProjectId ?? undefined)
  }

  async function handlePin(questId: string, pinned: boolean) {
    const result = await api.updateQuest(questId, { pinned })
    if (!result.ok) {
      setError(result.error)
      return
    }
    await loadQuests()
  }

  async function handleArchive(questId: string, deleted: boolean) {
    const quest = knownQuests.find((item) => item.id === questId)
    if (deleted && quest?.activeRunId) {
      const confirmed = window.confirm(t('正在执行中，归档会先取消当前执行。继续吗？'))
      if (!confirmed) return
      const cancelled = await api.cancelRun(quest.activeRunId)
      if (!cancelled.ok) {
        setError(cancelled.error)
        return
      }
      let cleared = false
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const current = await api.getQuest(questId)
        if (current.ok && !current.data.activeRunId) {
          cleared = true
          break
        }
        await new Promise((resolve) => window.setTimeout(resolve, 150))
      }
      if (!cleared) {
        setError(t('当前执行尚未完全停止，请稍后再试'))
        return
      }
    }

    const result = await api.updateQuest(questId, { deleted })
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (!deleted && activeQuestId === questId) {
      navigate(`/quests/${questId}`)
    } else if (deleted && activeQuestId === questId && activeProjectId) {
      const nextQuestId = nextSessionIdAfterDelete(questId)
      if (nextQuestId) navigate(`/quests/${nextQuestId}`)
      else navigate(`/projects/${activeProjectId}`)
    }
    await loadQuests()
    await onOverviewChanged?.(activeProjectId ?? undefined)
  }

  const filteredSessions = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase()
    return normalized
      ? sessions.filter((quest) => questLabel(quest, t).toLowerCase().includes(normalized))
      : sessions
  }, [sessions, searchQuery, t])

  const pinnedSessions = filteredSessions.filter((quest) => quest.pinned)
  const unpinnedSessions = filteredSessions.filter((quest) => !quest.pinned)
  const archivedSessionsByDate = useMemo(() => {
    const groups = new Map<string, Quest[]>()
    for (const quest of archivedSessions) {
      const key = quest.deletedAt?.slice(0, 10) ?? 'unknown'
      const current = groups.get(key)
      if (current) current.push(quest)
      else groups.set(key, [quest])
    }
    return Array.from(groups.entries()).map(([date, quests]) => ({ date, quests }))
  }, [archivedSessions])

  function renderQuest(quest: Quest, archived = false) {
    const presenceState = getSessionPresenceState(quest, activeQuestId)
    if (renamingId === quest.id) {
      return (
        <div key={quest.id} className="pluse-sidebar-item pluse-sidebar-row pluse-sidebar-rename-row">
          <input
            ref={renameInputRef}
            className="pluse-sidebar-rename-input"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleRename(quest.id, renameValue)
              if (event.key === 'Escape') setRenamingId(null)
            }}
            onBlur={() => void handleRename(quest.id, renameValue)}
          />
        </div>
      )
    }

    return (
      <div
        key={quest.id}
        className={`pluse-sidebar-item pluse-sidebar-row${quest.id === activeQuestId ? ' is-active' : ''}${archived ? ' pluse-sidebar-archived-item' : ''}${quest.unread ? ' is-unread' : ''}${quest.pinned && !archived ? ' is-pinned' : ''}`}
      >
        <Link
          className="pluse-sidebar-item-main"
          to={`/quests/${quest.id}`}
          onClick={onNavigate}
          onDoubleClick={(event) => {
            event.preventDefault()
            setRenamingId(quest.id)
            setRenameValue(questLabel(quest, t))
          }}
        >
          <div className="pluse-sidebar-item-title">
            {presenceState ? (
              <span
                className={`pluse-sidebar-presence-dot is-${presenceState}`}
                aria-hidden="true"
              />
            ) : null}
            <strong>{questLabel(quest, t)}</strong>
          </div>
          <div className="pluse-sidebar-item-meta" title={formatSidebarAbsoluteTime(quest.updatedAt, locale)}>
            <span className="pluse-meta-inline">
              <ClockIcon className="pluse-icon pluse-inline-icon" />
              {formatSidebarTime(quest.updatedAt, t)}
            </span>
          </div>
        </Link>
        <div className="pluse-sidebar-item-actions">
          {!archived ? (
            <button
              type="button"
              className={`pluse-sidebar-action-btn${quest.pinned ? ' is-active' : ''}`}
              onClick={(event) => {
                event.preventDefault()
                void handlePin(quest.id, !quest.pinned)
              }}
              aria-label={quest.pinned ? t('取消固定') : t('固定')}
              title={quest.pinned ? t('取消固定') : t('固定')}
            >
              <PinIcon className="pluse-icon" />
            </button>
          ) : null}
          <button
            type="button"
            className="pluse-sidebar-action-btn"
            onClick={(event) => {
              event.preventDefault()
              void handleArchive(quest.id, !archived)
            }}
            aria-label={archived ? t('恢复') : t('归档')}
            title={archived ? t('恢复') : t('归档')}
          >
            <ArchiveIcon className="pluse-icon" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <aside className="pluse-sidebar" ref={sidebarRef}>
      <div className="pluse-mobile-panel-header">
        <button type="button" className="pluse-icon-button" onClick={onRequestClose} aria-label={t('关闭侧栏')} title={t('关闭侧栏')}>
          <CloseIcon className="pluse-icon" />
        </button>
      </div>

      <div className="pluse-sidebar-body">
        <section className="pluse-sidebar-section pluse-sidebar-section-context">
          <div className="pluse-sidebar-context-label">{t('项目')}</div>
          <div className="pluse-project-context-row">
            <div className="pluse-project-switcher" ref={pickerRef}>
              <button
                type="button"
                className={`pluse-project-switcher-btn${projectPickerOpen ? ' is-open' : ''}`}
                onClick={() => {
                  setProjectPickerOpen((value) => !value)
                  setNewProjectOpen(false)
                }}
              >
                <div className="pluse-project-switcher-label">
                  <strong>{activeProject?.name ?? t('选择项目')}</strong>
                  <span>{activeProject ? shortPath(activeProject.workDir) : t('无项目')}</span>
                </div>
                <span className="pluse-project-switcher-chevron" aria-hidden="true">⌄</span>
              </button>

              {projectPickerOpen ? (
                <div className="pluse-project-picker">
                  <div className="pluse-project-picker-list">
                    {projects.map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        className={`pluse-project-picker-item${project.id === activeProjectId ? ' is-active' : ''}`}
                        onClick={() => handleSelectProject(project.id)}
                      >
                        <span className="pluse-sidebar-dot" aria-hidden="true" />
                        <div className="pluse-project-picker-item-text">
                          <strong>{project.name}</strong>
                          <span>{shortPath(project.workDir)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="pluse-project-picker-footer">
                    {newProjectOpen ? (
                      <form className="pluse-sidebar-form" onSubmit={handleCreateProject}>
                        <input
                          value={projectName}
                          onChange={(event) => setProjectName(event.target.value)}
                          placeholder={t('项目名称（可选）')}
                        />
                        <input
                          value={projectDir}
                          onChange={(event) => setProjectDir(event.target.value)}
                          placeholder={t('工作目录，如 ~/projects/xxx')}
                          required
                        />
                        <textarea
                          value={projectGoal}
                          onChange={(event) => setProjectGoal(event.target.value)}
                          placeholder={t('项目目标（可选）')}
                          rows={2}
                        />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button type="button" className="pluse-button pluse-button-ghost" onClick={() => setNewProjectOpen(false)}>
                            {t('取消')}
                          </button>
                          <button type="submit" className="pluse-button" style={{ flex: 1 }}>
                            {t('打开')}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button type="button" className="pluse-project-picker-add" onClick={() => setNewProjectOpen(true)}>
                        <PlusIcon className="pluse-icon" />
                        {t('添加项目')}
                      </button>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <button
              type="button"
              className="pluse-icon-button pluse-project-settings-btn"
              onClick={() => {
                if (!activeProjectId) return
                setProjectPickerOpen(false)
                setNewProjectOpen(false)
                onNavigate?.()
                navigate(`/projects/${activeProjectId}`)
              }}
              aria-label={t('打开项目面板')}
              title={t('项目面板')}
              disabled={!activeProjectId}
            >
              <SlidersIcon className="pluse-icon" />
            </button>
          </div>
        </section>

        {sessions.length > 0 ? (
          <div className="pluse-sidebar-search">
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('搜索')}
              className="pluse-sidebar-search-input"
            />
          </div>
        ) : null}

        <div className="pluse-sidebar-scroll-pane">
          <section className="pluse-sidebar-section pluse-sidebar-section-list">
            <div className="pluse-sidebar-list pluse-sidebar-list-dense">
              {pinnedSessions.length > 0 ? (
                <>
                  <div className="pluse-sidebar-section-label">{t('固定')}</div>
                  {pinnedSessions.map((quest) => renderQuest(quest))}
                  {unpinnedSessions.length > 0 ? <div className="pluse-sidebar-section-label">{t('最近')}</div> : null}
                </>
              ) : null}
              {unpinnedSessions.map((quest) => renderQuest(quest))}
              {sessions.length === 0 ? (
                <div className="pluse-empty-state pluse-sidebar-empty">{t('还没有内容')}</div>
              ) : filteredSessions.length === 0 ? (
                <div className="pluse-empty-state pluse-sidebar-empty">{t('无搜索结果')}</div>
              ) : null}
              {archivedSessions.length > 0 ? (
                <div className="pluse-sidebar-archive-group">
                  <button
                    type="button"
                    className="pluse-sidebar-archive-toggle"
                    onClick={() => setArchivedSessionsExpanded((value) => !value)}
                  >
                    <span>{archivedSessionsExpanded ? '▾' : '▸'} {t('归档')} ({archivedSessions.length})</span>
                  </button>
                  {archivedSessionsExpanded ? (
                    <div className="pluse-sidebar-archive-list">
                      {archivedSessionsByDate.map(({ date, quests }) => (
                        <div key={date} className="pluse-sidebar-archive-date-group">
                          <div className="pluse-sidebar-archive-date-label">{formatArchiveDateLabel(date === 'unknown' ? undefined : date, locale, t)}</div>
                          {quests.map((quest) => renderQuest(quest, true))}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <section className="pluse-sidebar-section-new-session">
          <button
            type="button"
            className="pluse-sidebar-chip-link pluse-sidebar-new-session-card"
            aria-label={t('新建会话')}
            onClick={() => void handleCreateQuest('session')}
            disabled={!activeProjectId}
          >
            <PlusIcon className="pluse-icon" />
            <span>{t('新建会话')}</span>
          </button>
        </section>

        {error ? <p className="pluse-error" style={{ padding: '0 8px 8px' }}>{error}</p> : null}
      </div>
    </aside>
  )
}
