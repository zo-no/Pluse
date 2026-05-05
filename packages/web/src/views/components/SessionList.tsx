import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import type { Domain, Project, Quest, SessionCategory } from '@pluse/types'
import * as api from '@/api/client'
import { useI18n } from '@/i18n'
import { useSseEvent } from '@/views/hooks/useSseEvent'
import { displayQuestName } from '@/views/utils/display'
import { DomainSidebar } from './DomainSidebar'
import { TodoPanel } from './TodoPanel'
import { ArchiveIcon, ClockIcon, CloseIcon, FolderIcon, FolderOpenIcon, PinIcon, PlusIcon, RouteIcon } from './icons'

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
          ) : quest.pinned && !archived ? (
            <PinIcon className="pluse-icon pluse-sidebar-leading-icon is-pin" />
          ) : null}
          <strong>{displayQuestName(quest, t)}</strong>
        </div>
        {archived ? (
          <div className="pluse-sidebar-item-meta" title={formatSidebarAbsoluteTime(quest.updatedAt, locale)}>
            <span className="pluse-meta-inline pluse-sidebar-item-time">
              <ClockIcon className="pluse-icon pluse-inline-icon" />
              {formatSidebarTime(quest.updatedAt, t)}
            </span>
          </div>
        ) : null}
      </Link>
      <div className="pluse-sidebar-item-actions">
        {!archived ? (
          <button
            type="button"
            className={`pluse-sidebar-action-btn is-pin-btn${quest.pinned ? ' is-active' : ''}`}
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
  const [sessionCategories, setSessionCategories] = useState<SessionCategory[]>([])
  const [uncategorizedSessionsExpanded, setUncategorizedSessionsExpanded] = useState(true)
  const [archivedSessionsExpanded, setArchivedSessionsExpanded] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<'projects' | 'sessions' | 'automation' | 'todo' | 'reminder' | 'check_in'>(() => (activeProjectId ? 'sessions' : 'projects'))
  const [domains, setDomains] = useState<Domain[]>([])
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
  const previousActiveProjectIdRef = useRef<string | null>(null)
  const reloadTimerRef = useRef<number | null>(null)
  const pendingQuestReloadRef = useRef(false)
  const pendingSessionCategoryReloadRef = useRef(false)
  const pendingDomainReloadRef = useRef(false)
  const sessionCategoryRequestSeqRef = useRef(0)

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  )

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
      // 全部视图：只加载所有项目中 pinned 的会话
      const result = await api.getQuests({ kind: 'session', deleted: false })
      if (result.ok) setSessions(result.data.filter((q) => q.pinned))
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

  const loadSessionCategories = useCallback(async () => {
    if (!activeProjectId) {
      sessionCategoryRequestSeqRef.current += 1
      setSessionCategories([])
      return
    }
    const requestSeq = sessionCategoryRequestSeqRef.current + 1
    sessionCategoryRequestSeqRef.current = requestSeq
    const result = await api.getSessionCategories(activeProjectId)
    if (requestSeq !== sessionCategoryRequestSeqRef.current) return
    if (result.ok) setSessionCategories(result.data)
  }, [activeProjectId])

  const loadDomains = useCallback(async () => {
    const result = await api.getDomains()
    if (result.ok) setDomains(result.data)
  }, [])

  useEffect(() => {
    void loadQuests()
  }, [loadQuests])

  useEffect(() => {
    void loadSessionCategories()
  }, [loadSessionCategories])

  useEffect(() => {
    void loadDomains()
    return () => {
      if (reloadTimerRef.current) {
        window.clearTimeout(reloadTimerRef.current)
        reloadTimerRef.current = null
      }
      pendingQuestReloadRef.current = false
      pendingSessionCategoryReloadRef.current = false
      pendingDomainReloadRef.current = false
      sessionCategoryRequestSeqRef.current += 1
    }
  }, [])

  useEffect(() => {
    pendingQuestReloadRef.current = false
    pendingSessionCategoryReloadRef.current = false
    if (reloadTimerRef.current) {
      window.clearTimeout(reloadTimerRef.current)
      reloadTimerRef.current = null
    }

    const previousProjectId = previousActiveProjectIdRef.current
    if (previousProjectId !== activeProjectId) {
      setUncategorizedSessionsExpanded(true)
    }
    previousActiveProjectIdRef.current = activeProjectId
  }, [activeProjectId])

  useSseEvent(
    (event) => {
      const shouldReloadQuests = (event.type === 'quest_updated' || event.type === 'quest_deleted')
        && (activeProjectId == null || event.data.projectId === activeProjectId)
      const shouldReloadSessionCategories = activeProjectId != null
        && event.type === 'project_updated'
        && event.data.projectId === activeProjectId
      if (!shouldReloadQuests && !shouldReloadSessionCategories) return

      if (shouldReloadQuests) pendingQuestReloadRef.current = true
      if (shouldReloadSessionCategories) pendingSessionCategoryReloadRef.current = true
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current)
      reloadTimerRef.current = window.setTimeout(() => {
        const nextQuestReload = pendingQuestReloadRef.current
        const nextSessionCategoryReload = pendingSessionCategoryReloadRef.current
        pendingQuestReloadRef.current = false
        pendingSessionCategoryReloadRef.current = false

        if (nextQuestReload) void loadQuests()
        if (nextSessionCategoryReload) void loadSessionCategories()
      }, 300)
    },
    {
      onReconnect: () => {
        pendingQuestReloadRef.current = false
        pendingSessionCategoryReloadRef.current = false
        pendingDomainReloadRef.current = false
        sessionCategoryRequestSeqRef.current += 1
        if (reloadTimerRef.current) {
          window.clearTimeout(reloadTimerRef.current)
          reloadTimerRef.current = null
        }
        void loadQuests()
        void loadSessionCategories()
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

  function openProject(projectId: string) {
    onSelectProject(projectId)
    onNavigate?.()
    navigate(`/projects/${projectId}`)
  }

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
    navigate(`/projects/${result.data.id}`)
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
            title: t('新自动化'),
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

  const handleToggleSessionCategoryCollapsed = useCallback(async (categoryId: string, collapsed: boolean) => {
    setError(null)
    const previousCollapsed = sessionCategories.find((category) => category.id === categoryId)?.collapsed ?? !collapsed
    setSessionCategories((current) => current.map((category) => (
      category.id === categoryId
        ? { ...category, collapsed }
        : category
    )))

    const result = await api.updateSessionCategory(categoryId, { collapsed })
    if (!result.ok) {
      setSessionCategories((current) => current.map((category) => (
        category.id === categoryId
          ? { ...category, collapsed: previousCollapsed }
          : category
      )))
      setError(result.error)
      return
    }

    setSessionCategories((current) => current.map((category) => (
      category.id === categoryId
        ? result.data
        : category
    )))
  }, [sessionCategories])

  const pinnedSessions = sessions.filter((quest) => quest.pinned)
  const unpinnedSessions = sessions.filter((quest) => !quest.pinned)

  const categorizedSessionSections = useMemo(() => {
    const grouped = new Map<string, Quest[]>()
    for (const category of sessionCategories) grouped.set(category.id, [])

    const ungrouped: Quest[] = []
    for (const quest of unpinnedSessions) {
      const categoryId = quest.sessionCategoryId
      if (categoryId && grouped.has(categoryId)) {
        grouped.get(categoryId)!.push(quest)
      } else {
        ungrouped.push(quest)
      }
    }

    return {
      categories: sessionCategories
        .map((category) => ({
          category,
          quests: grouped.get(category.id) ?? [],
        }))
        .filter(({ quests }) => quests.length > 0),
      ungrouped,
    }
  }, [sessionCategories, unpinnedSessions])

  // 全部视图：按项目分组展示 pinned 会话
  const allProjectPinnedSections = useMemo(() => {
    if (activeProjectId) return null
    const grouped = new Map<string, Quest[]>()
    for (const quest of sessions) {
      const pid = quest.projectId ?? ''
      const current = grouped.get(pid)
      if (current) current.push(quest)
      else grouped.set(pid, [quest])
    }
    return Array.from(grouped.entries()).map(([projectId, quests]) => ({
      projectId,
      projectName: projects.find((p) => p.id === projectId)?.name ?? projectId,
      quests,
    }))
  }, [activeProjectId, sessions, projects])

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

  function renderSessionFolderSection(
    folderKey: string,
    label: string,
    quests: Quest[],
    expanded: boolean,
    onToggle: () => void,
  ) {
    return (
      <div key={folderKey} className="pluse-sidebar-category-group">
        <button
          type="button"
          className={`pluse-sidebar-item pluse-sidebar-row pluse-sidebar-category-row${expanded ? ' is-expanded' : ''}`}
          onClick={onToggle}
          aria-expanded={expanded}
        >
          <div className="pluse-sidebar-item-main pluse-sidebar-category-main">
            <div className="pluse-sidebar-item-title">
              <span className="pluse-sidebar-category-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
              {expanded ? (
                <FolderOpenIcon className="pluse-icon pluse-sidebar-leading-icon is-folder" />
              ) : (
                <FolderIcon className="pluse-icon pluse-sidebar-leading-icon is-folder" />
              )}
              <strong title={label}>{label}</strong>
            </div>
            <div className="pluse-sidebar-item-meta">
              <span className="pluse-sidebar-category-count">{quests.length}</span>
            </div>
          </div>
        </button>
        {expanded ? (
          <div className="pluse-sidebar-category-children">
            {quests.map((quest) => renderQuest(quest))}
          </div>
        ) : null}
      </div>
    )
  }

  function renderSessionCategorySection(category: SessionCategory, quests: Quest[]) {
    return renderSessionFolderSection(
      category.id,
      category.name,
      quests,
      !category.collapsed,
      () => void handleToggleSessionCategoryCollapsed(category.id, !category.collapsed),
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
        <div className="pluse-sidebar-tabs pluse-sidebar-tabs-vertical" role="tablist" aria-label={t('侧栏视图')}>
          <button
            type="button"
            className={`pluse-sidebar-tab${sidebarTab === 'projects' ? ' is-active' : ''}`}
            onClick={() => setSidebarTab('projects')}
          >
            {t('项目')}
          </button>
          <button
            type="button"
            className={`pluse-sidebar-tab${sidebarTab === 'sessions' ? ' is-active' : ''}`}
            onClick={() => setSidebarTab('sessions')}
          >
            {t('会话')}
          </button>
          <button
            type="button"
            className={`pluse-sidebar-tab${sidebarTab === 'todo' ? ' is-active' : ''}`}
            onClick={() => setSidebarTab('todo')}
          >
            {t('待办')}
          </button>
          <button
            type="button"
            className={`pluse-sidebar-tab${sidebarTab === 'reminder' ? ' is-active' : ''}`}
            onClick={() => setSidebarTab('reminder')}
          >
            {t('提醒')}
          </button>
          <button
            type="button"
            className={`pluse-sidebar-tab${sidebarTab === 'check_in' ? ' is-active' : ''}`}
            onClick={() => setSidebarTab('check_in')}
          >
            {t('打卡')}
          </button>
        </div>

        {sidebarTab === 'projects' ? (
          <DomainSidebar
            domains={domains}
            projects={projects}
            activeProjectId={activeProjectId}
            onSelectProject={openProject}
            onProjectsChanged={onProjectsChanged}
            onDomainsChanged={loadDomains}
            onCreateProject={() => setNewProjectModalOpen(true)}
            onNavigate={onNavigate}
          />
        ) : sidebarTab === 'todo' || sidebarTab === 'reminder' || sidebarTab === 'check_in' ? (
          <TodoPanel
            projectId={activeProjectId}
            projectName={activeProject?.name ?? null}
            projects={projects}
            activeQuestId={activeQuestId}
            onRequestClose={onRequestClose}
            embedded
            initialTab={sidebarTab === 'todo' ? 'human' : sidebarTab}
          />
        ) : (
          <>
            <div className="pluse-sidebar-scroll-pane">
              <section className="pluse-sidebar-section pluse-sidebar-section-list">
                <div className="pluse-sidebar-list pluse-sidebar-list-dense">
                  {allProjectPinnedSections ? (
                    // 全部视图：按项目分组显示 pinned 会话
                    <>
                      {allProjectPinnedSections.map(({ projectId, projectName, quests }) =>
                        renderSessionFolderSection(
                          `project-${projectId}`,
                          projectName,
                          quests,
                          true,
                          () => {},
                        )
                      )}
                      {allProjectPinnedSections.length === 0 ? (
                        <div className="pluse-empty-state pluse-sidebar-empty">{t('还没有内容')}</div>
                      ) : null}
                    </>
                  ) : (
                    // 单项目视图：正常显示
                    <>
                      {pinnedSessions.map((quest) => renderQuest(quest))}
                      {categorizedSessionSections.categories.map(({ category, quests }) => renderSessionCategorySection(category, quests))}
                      {categorizedSessionSections.ungrouped.length > 0 ? renderSessionFolderSection(
                        'uncategorized-sessions',
                        t('未分类'),
                        categorizedSessionSections.ungrouped,
                        uncategorizedSessionsExpanded,
                        () => setUncategorizedSessionsExpanded((value) => !value),
                      ) : null}
                      {sessions.length === 0 ? (
                        <div className="pluse-empty-state pluse-sidebar-empty">{t('还没有内容')}</div>
                      ) : null}
                    </>
                  )}

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

    </>
  )
}
