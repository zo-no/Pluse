import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import type { Domain, Project, Quest } from '@pluse/types'
import * as api from '@/api/client'
import { useI18n } from '@/i18n'
import { useSseEvent } from '@/views/hooks/useSseEvent'
import { displayQuestName } from '@/views/utils/display'
import { getPreferredSessionId } from '@/views/utils/session-selection'
import { DomainSidebar } from './DomainSidebar'
import { ArchiveIcon, ClockIcon, CloseIcon, PinIcon, PlusIcon } from './icons'

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

function formatArchiveDateLabel(value?: string, locale = 'zh-CN', t?: (key: string) => string): string {
  if (!value) return t ? t('未记录日期') : '未记录日期'
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(value))
}

function getSessionPresenceState(quest: Quest, activeQuestId: string | null): 'running' | 'complete' | null {
  if (quest.activeRunId) return 'running'
  if (quest.completionOutput && activeQuestId !== quest.id) return 'complete'
  return null
}

function projectDomainName(project: Project, domains: Domain[], t: (key: string, values?: Record<string, string | number>) => string): string {
  if (!project.domainId) return t('未分组')
  return domains.find((domain) => domain.id === project.domainId)?.name ?? t('未分组')
}

const QuestItem = memo(function QuestItem({
  quest,
  archived,
  active,
  locale,
  presenceState,
  t,
  onNavigate,
  onStartRename,
  onTogglePin,
  onToggleArchive,
}: {
  quest: Quest
  archived: boolean
  active: boolean
  locale: string
  presenceState: 'running' | 'complete' | null
  t: (key: string, values?: Record<string, string | number>) => string
  onNavigate?: () => void
  onStartRename: (quest: Quest) => void
  onTogglePin: (questId: string, pinned: boolean) => void
  onToggleArchive: (questId: string, archived: boolean) => void
}) {
  return (
    <div
      className={`pluse-sidebar-item pluse-sidebar-row${active ? ' is-active' : ''}${archived ? ' pluse-sidebar-archived-item' : ''}${quest.unread ? ' is-unread' : ''}${quest.pinned && !archived ? ' is-pinned' : ''}`}
    >
      <Link
        className="pluse-sidebar-item-main"
        to={`/quests/${quest.id}`}
        onClick={onNavigate}
        onDoubleClick={(event) => {
          event.preventDefault()
          onStartRename(quest)
        }}
      >
        <div className="pluse-sidebar-item-title">
          {presenceState ? (
            <span className={`pluse-sidebar-presence-dot is-${presenceState}`} aria-hidden="true" />
          ) : null}
          <strong>{displayQuestName(quest, t)}</strong>
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
              onTogglePin(quest.id, !quest.pinned)
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
            onToggleArchive(quest.id, !archived)
          }}
          aria-label={archived ? t('恢复') : t('归档')}
          title={archived ? t('恢复') : t('归档')}
        >
          <ArchiveIcon className="pluse-icon" />
        </button>
      </div>
    </div>
  )
})

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
  const [sidebarTab, setSidebarTab] = useState<'sessions' | 'domains'>('sessions')
  const [domains, setDomains] = useState<Domain[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [newProjectModalOpen, setNewProjectModalOpen] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projectDir, setProjectDir] = useState('')
  const [projectGoal, setProjectGoal] = useState('')
  const [projectDomainId, setProjectDomainId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const reloadTimerRef = useRef<number | null>(null)
  const pendingQuestReloadRef = useRef(false)
  const pendingDomainReloadRef = useRef(false)

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  )

  const activeDomainName = useMemo(() => {
    if (!activeProject?.domainId) return t('未分组')
    return domains.find((d) => d.id === activeProject.domainId)?.name ?? t('未分组')
  }, [activeProject, domains, t])

  const sidebarContextLabel = useMemo(() => (
    `${t('会话栏')}-${sidebarTab === 'domains' ? t('领域') : t('会话')}`
  ), [sidebarTab, t])

  const knownQuests = useMemo(
    () => [...sessions, ...archivedSessions],
    [sessions, archivedSessions],
  )

  const nextSessionIdAfterDelete = useCallback((questId: string): string | null => {
    const index = sessions.findIndex((quest) => quest.id === questId)
    if (index === -1) return null
    const nextQuest = sessions[index + 1] || sessions[index - 1]
    return nextQuest ? nextQuest.id : null
  }, [sessions])

  const loadQuests = useCallback(async () => {
    if (!activeProjectId) {
      setSessions([])
      setArchivedSessions([])
      return
    }
    const [sessionResult, archivedResult] = await Promise.all([
      api.getQuests({ projectId: activeProjectId, kind: 'session', deleted: false }),
      api.getQuests({ projectId: activeProjectId, kind: 'session', deleted: true }),
    ])
    if (sessionResult.ok) setSessions(sessionResult.data)
    if (archivedResult.ok) setArchivedSessions(archivedResult.data)
  }, [activeProjectId])

  const loadDomains = useCallback(async () => {
    const result = await api.getDomains()
    if (result.ok) setDomains(result.data)
  }, [])

  useEffect(() => {
    void loadQuests()
  }, [loadQuests])

  useEffect(() => {
    void loadDomains()
  }, [loadDomains])

  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) {
        window.clearTimeout(reloadTimerRef.current)
        reloadTimerRef.current = null
      }
      pendingQuestReloadRef.current = false
      pendingDomainReloadRef.current = false
    }
  }, [])

  useEffect(() => {
    pendingQuestReloadRef.current = false
    pendingDomainReloadRef.current = false
    if (reloadTimerRef.current) {
      window.clearTimeout(reloadTimerRef.current)
      reloadTimerRef.current = null
    }
  }, [activeProjectId])

  useSseEvent(
    (event) => {
      const shouldReloadQuests = activeProjectId != null
        && (event.type === 'quest_updated' || event.type === 'quest_deleted')
        && event.data.projectId === activeProjectId
      const shouldReloadDomains = event.type === 'domain_updated' || event.type === 'domain_deleted'
      if (!shouldReloadQuests && !shouldReloadDomains) return

      if (shouldReloadQuests) pendingQuestReloadRef.current = true
      if (shouldReloadDomains) pendingDomainReloadRef.current = true
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current)
      reloadTimerRef.current = window.setTimeout(() => {
        const nextQuestReload = pendingQuestReloadRef.current
        const nextDomainReload = pendingDomainReloadRef.current
        pendingQuestReloadRef.current = false
        pendingDomainReloadRef.current = false

        if (nextQuestReload) void loadQuests()
        if (nextDomainReload) void loadDomains()
      }, 300)
    },
    {
      onReconnect: () => {
        pendingQuestReloadRef.current = false
        pendingDomainReloadRef.current = false
        if (reloadTimerRef.current) {
          window.clearTimeout(reloadTimerRef.current)
          reloadTimerRef.current = null
        }
        void loadQuests()
        void loadDomains()
      },
    },
  )

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  const handleStartRename = useCallback((quest: Quest) => {
    setRenamingId(quest.id)
    setRenameValue(displayQuestName(quest, t))
  }, [t])

  async function handleCreateProject(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const result = await api.openProject({
      name: projectName || undefined,
      workDir: projectDir,
      goal: projectGoal || undefined,
      domainId: projectDomainId || null,
    })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setProjectName('')
    setProjectDir('')
    setProjectGoal('')
    setProjectDomainId('')
    setNewProjectModalOpen(false)
    await onProjectsChanged()
    onNavigate?.()
    navigate(`/projects/${result.data.id}`)
  }

  function handleSelectProject(projectId: string) {
    void openProjectFirstSession(projectId)
  }

  async function openProjectFirstSession(projectId: string) {
    onSelectProject(projectId)
    setProjectPickerOpen(false)
    onNavigate?.()
    const questId = await getPreferredSessionId(projectId)
    if (questId) {
      navigate(`/quests/${questId}`)
      return
    }
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

  const handleRename = useCallback(async (questId: string, nextName: string) => {
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
  }, [activeProjectId, knownQuests, loadQuests, onOverviewChanged])

  const handlePin = useCallback(async (questId: string, pinned: boolean) => {
    const result = await api.updateQuest(questId, { pinned })
    if (!result.ok) {
      setError(result.error)
      return
    }
    await loadQuests()
  }, [loadQuests])

  const handleArchive = useCallback(async (questId: string, deleted: boolean) => {
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
  }, [activeProjectId, activeQuestId, knownQuests, loadQuests, navigate, nextSessionIdAfterDelete, onOverviewChanged, t])

  const handleTogglePin = useCallback((questId: string, pinned: boolean) => {
    void handlePin(questId, pinned)
  }, [handlePin])

  const handleToggleArchive = useCallback((questId: string, archived: boolean) => {
    void handleArchive(questId, archived)
  }, [handleArchive])

  const filteredSessions = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase()
    return normalized
      ? sessions.filter((quest) => displayQuestName(quest, t).toLowerCase().includes(normalized))
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
      <QuestItem
        key={quest.id}
        quest={quest}
        archived={archived}
        active={quest.id === activeQuestId}
        locale={locale}
        presenceState={presenceState}
        t={t}
        onNavigate={onNavigate}
        onStartRename={handleStartRename}
        onTogglePin={handleTogglePin}
        onToggleArchive={handleToggleArchive}
      />
    )
  }

  return (
    <>
    <aside className="pluse-sidebar" ref={sidebarRef}>
      <div className="pluse-mobile-panel-header">
        <button type="button" className="pluse-icon-button" onClick={onRequestClose} aria-label={t('关闭侧栏')} title={t('关闭侧栏')}>
          <CloseIcon className="pluse-icon" />
        </button>
      </div>

      <div className="pluse-sidebar-body">
        {/* 当前项目上下文 */}
        <div className="pluse-sidebar-project-context">
          <span className="pluse-sidebar-project-context-domain">{sidebarContextLabel}</span>
          <div className="pluse-project-switcher">
            <button
              type="button"
              className={`pluse-project-switcher-btn${projectPickerOpen ? ' is-open' : ''}`}
              onClick={() => setProjectPickerOpen((value) => !value)}
              aria-haspopup="listbox"
              aria-expanded={projectPickerOpen}
            >
              <div className="pluse-project-switcher-label">
                <strong>{activeProject?.name ?? t('选择项目')}</strong>
                <span>{activeDomainName}</span>
              </div>
              <span className="pluse-project-switcher-chevron" aria-hidden="true">{projectPickerOpen ? '▴' : '▾'}</span>
            </button>

            {projectPickerOpen ? (
              <div className="pluse-project-picker">
                <div className="pluse-project-picker-list" role="listbox" aria-label={t('选择项目')}>
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      className={`pluse-project-picker-item${project.id === activeProjectId ? ' is-active' : ''}`}
                      onClick={() => handleSelectProject(project.id)}
                    >
                      <span className="pluse-project-avatar is-compact" aria-hidden="true">{project.icon?.trim() || project.name.trim()[0]?.toUpperCase() || '#'}</span>
                      <div className="pluse-project-picker-item-text">
                        <strong>{project.name}</strong>
                        <span>{projectDomainName(project, domains, t)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Domain / Session tabs */}
        <div className="pluse-sidebar-tabs" role="tablist" aria-label={t('侧栏视图')}>
          <button
            type="button"
            className={`pluse-sidebar-tab${sidebarTab === 'domains' ? ' is-active' : ''}`}
            onClick={() => setSidebarTab('domains')}
          >
            {t('领域')}
          </button>
          <button
            type="button"
            className={`pluse-sidebar-tab${sidebarTab === 'sessions' ? ' is-active' : ''}`}
            onClick={() => setSidebarTab('sessions')}
          >
            {t('会话')}
          </button>
        </div>

        {sidebarTab === 'domains' ? (
          <DomainSidebar
            domains={domains}
            projects={projects}
            activeProjectId={activeProjectId}
            onSelectProject={handleSelectProject}
            onProjectsChanged={onProjectsChanged}
            onDomainsChanged={loadDomains}
            onCreateProject={() => setNewProjectModalOpen(true)}
            onNavigate={onNavigate}
          />
        ) : (
          <>
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
                      {unpinnedSessions.length > 0 ? (
                        <div className="pluse-sidebar-section-label">{t('最近')}</div>
                      ) : null}
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
                              <div className="pluse-sidebar-archive-date-label">
                                {formatArchiveDateLabel(date === 'unknown' ? undefined : date, locale, t)}
                              </div>
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
          </>
        )}

        {error ? <p className="pluse-error" style={{ padding: '0 8px 8px' }}>{error}</p> : null}
      </div>

    </aside>

    {/* 新建项目 Modal — 全局弹窗，渲染到 body */}
    {newProjectModalOpen ? createPortal(
      <div className="pluse-modal-backdrop" onClick={() => setNewProjectModalOpen(false)}>
        <section
          className="pluse-modal-panel pluse-new-project-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <h2>{t('新建项目')}</h2>
          <form className="pluse-sidebar-form" onSubmit={handleCreateProject}>
            <input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder={t('项目名称（可选）')}
              autoFocus
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
            <label>
              <span className="pluse-form-label">{t('领域')}</span>
              <select value={projectDomainId} onChange={(event) => setProjectDomainId(event.target.value)}>
                <option value="">{t('未分组')}</option>
                {domains.map((domain) => (
                  <option key={domain.id} value={domain.id}>{domain.name}</option>
                ))}
              </select>
            </label>
            {error ? <p className="pluse-error">{error}</p> : null}
            <div className="pluse-domain-form-actions">
              <button type="submit" className="pluse-button">
                {t('创建')}
              </button>
              <button
                type="button"
                className="pluse-button pluse-button-ghost"
                onClick={() => {
                  setNewProjectModalOpen(false)
                  setProjectName('')
                  setProjectDir('')
                  setProjectGoal('')
                  setProjectDomainId('')
                  setError(null)
                }}
              >
                {t('取消')}
              </button>
            </div>
          </form>
        </section>
      </div>,
      document.body,
    ) : null}
    </>
  )
}
