import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, type Location as RouterLocation } from 'react-router-dom'
import type { AuthMe, Project, ProjectOverview, ProjectRecentOutput, Quest } from '@pluse/types'
import * as api from '@/api/client'
import { ChatView } from '@/views/components/ChatView'
import { ClockIcon, MenuIcon, MoonIcon, RailIcon, SettingsIcon, SidebarIcon, SunIcon } from '@/views/components/icons'
import { SessionList } from '@/views/components/SessionList'
import { TaskDetail } from '@/views/components/TaskDetail'
import { TodoPanel } from '@/views/components/TodoPanel'
import { SettingsPage } from './SettingsPage'
import { displayQuestName } from '@/views/utils/display'
import { THEME_STORAGE_KEY, applyTheme, resolveInitialTheme, type ThemeMode } from '@/views/utils/theme'
import { LoginPage } from './LoginPage'

function shortPath(value?: string | null): string {
  if (!value) return ''
  const normalized = value.replace(/^\/Users\/[^/]+/, '~')
  const isHome = normalized.startsWith('~/')
  const parts = normalized.replace(/^~\//, '').replace(/^\//, '').split('/').filter(Boolean)
  if (parts.length <= 3) return normalized
  return `${isHome ? '~/' : '/'}${parts.slice(0, 2).join('/')}/…/${parts.slice(-2).join('/')}`
}

function formatDateTime(value?: string): string {
  if (!value) return '未记录'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatOutputStatus(status: string): string {
  const normalized = status.toLowerCase()
  if (normalized === 'completed' || normalized === 'done') return '已完成'
  if (normalized === 'running') return '执行中'
  if (normalized === 'failed') return '失败'
  if (normalized === 'cancelled') return '已取消'
  if (normalized === 'pending') return '待处理'
  if (normalized === 'idle') return '空闲'
  return status
}

function scheduleSummary(schedule: ProjectOverview['schedule']): string {
  if (!schedule) return '暂无周期触发'
  if (schedule.lastRunAt && schedule.nextRunAt) {
    return `${formatDateTime(schedule.lastRunAt)} → ${formatDateTime(schedule.nextRunAt)}`
  }
  if (schedule.nextRunAt) return `下次 ${formatDateTime(schedule.nextRunAt)}`
  if (schedule.lastRunAt) return `最近 ${formatDateTime(schedule.lastRunAt)}`
  return '已配置，未触发'
}

function questLabel(quest: Quest): string {
  return displayQuestName(quest)
}

function taskOverlayState(location: RouterLocation): { backgroundLocation: RouterLocation } {
  return { backgroundLocation: location }
}

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

function OutputRow({ output }: { output: ProjectRecentOutput }) {
  const location = useLocation()
  const target = output.questId ? `/quests/${output.questId}` : undefined
  const summary = output.summary?.trim()
  const isGenericSummary = Boolean(summary && summary.includes('运行已完成'))
  const visibleSummary = summary && !isGenericSummary ? summary : null
  const content = (
    <>
      <div className="pluse-output-row-main">
        <div className="pluse-output-row-top">
          <strong>{output.title}</strong>
          <span className={`pluse-task-status is-${String(output.status).toLowerCase()}`}>{formatOutputStatus(output.status)}</span>
        </div>
        {visibleSummary ? <p>{visibleSummary}</p> : null}
      </div>
      <div className="pluse-output-row-meta">
        <span>{output.kind === 'chat_run' ? '会话' : '任务'}</span>
        <span className="pluse-meta-inline">
          <ClockIcon className="pluse-icon pluse-inline-icon" />
          {formatDateTime(output.completedAt)}
        </span>
      </div>
    </>
  )

  return target ? (
    <Link
      className="pluse-output-row"
      to={target}
      state={output.kind === 'chat_run' ? undefined : taskOverlayState(location)}
    >
      {content}
    </Link>
  ) : <div className="pluse-output-row">{content}</div>
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
  const navigate = useNavigate()
  const [overview, setOverview] = useState<ProjectOverview | null>(null)
  const [tab, setTab] = useState<'overview' | 'settings'>('overview')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')

  async function loadOverview() {
    const result = await api.getProjectOverview(projectId)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setOverview(result.data)
    setName(result.data.project.name)
    setGoal(result.data.project.goal ?? '')
    setSystemPrompt(result.data.project.systemPrompt ?? '')
    setError(null)
    onProjectLoaded(result.data)
  }

  useEffect(() => {
    void loadOverview()
  }, [projectId])

  async function saveProject() {
    setSaving(true)
    const result = await api.updateProject(projectId, { name, goal, systemPrompt })
    setSaving(false)
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
    return <div className="pluse-page pluse-page-loading">正在加载项目…</div>
  }

  return (
    <div className="pluse-page pluse-project-page">
      <div className="pluse-detail-shell">
        <div className="pluse-project-tabs-bar">
          <div className="pluse-project-tab-group">
            <button
              type="button"
              className={`pluse-project-tab${tab === 'overview' ? ' is-active' : ''}`}
              onClick={() => setTab('overview')}
            >
              概览
            </button>
            <button
              type="button"
              className={`pluse-project-tab${tab === 'settings' ? ' is-active' : ''}`}
              onClick={() => setTab('settings')}
            >
              设置
            </button>
          </div>
          <div className="pluse-project-tab-meta">
            <span className="pluse-info-path-sm">{shortPath(overview.project.workDir)}</span>
            {overview.project.pinned ? <span className="pluse-inline-pill">固定</span> : null}
          </div>
        </div>

        {tab === 'overview' ? (
          <div className="pluse-detail-grid">
            <div className="pluse-overview-row pluse-overview-strip">
              <div className="pluse-overview-stat">
                <span>会话</span>
                <strong>{overview.counts.sessions}</strong>
              </div>
              <div className="pluse-overview-stat">
                <span>AI 任务</span>
                <strong>{overview.counts.tasks}</strong>
              </div>
              <div className="pluse-overview-stat">
                <span>人类任务</span>
                <strong>{overview.counts.todos}</strong>
              </div>
              <div className="pluse-overview-stat">
                <span>等待中</span>
                <strong>{overview.waitingTodos.length}</strong>
              </div>
              <div className="pluse-overview-stat">
                <span>调度</span>
                <strong className="pluse-overview-stat-sm">{scheduleSummary(overview.schedule)}</strong>
              </div>
            </div>

            {overview.waitingTodos.length > 0 ? (
              <ProjectCompactSection
                key={`waiting-${overview.project.id}`}
                title="等待中"
                count={overview.waitingTodos.length}
                defaultOpen
                note="人类待办"
                scrollable={overview.waitingTodos.length > 3}
              >
                <div className="pluse-note-list pluse-overview-scroll-list">
                  {overview.waitingTodos.map((todo) => (
                    <div key={todo.id} className="pluse-note-item">
                      <div>
                        <strong>{todo.title}</strong>
                        <p>{todo.waitingInstructions || todo.description || '等待新的输入后再继续。'}</p>
                      </div>
                      <span className={`pluse-task-status is-${todo.status}`}>{todo.status}</span>
                    </div>
                  ))}
                </div>
              </ProjectCompactSection>
            ) : null}

            {overview.recentOutputs.length > 0 ? (
              <ProjectCompactSection
                key={`outputs-${overview.project.id}`}
                title="最近输出"
                count={overview.recentOutputs.length}
                defaultOpen={overview.recentOutputs.length <= 2}
                note="可折叠"
                scrollable={overview.recentOutputs.length > 2}
              >
                <div className="pluse-output-list pluse-output-list-scroll">
                  {overview.recentOutputs.map((output) => (
                    <OutputRow key={`${output.kind}:${output.id}`} output={output} />
                  ))}
                </div>
              </ProjectCompactSection>
            ) : null}
          </div>
        ) : (
          <div className="pluse-detail-grid">
            <div className="pluse-form-grid">
              <label>
                <span>项目名称</span>
                <input value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="pluse-form-span">
                <span>项目目标</span>
                <textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={2} />
              </label>
              <label className="pluse-form-span">
                <span>项目 Prompt</span>
                <textarea
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  rows={5}
                  placeholder="输入项目 Prompt"
                />
                <p className="pluse-info-copy">仅当前项目生效。全局系统 Prompt 在右上角设置里。</p>
              </label>
            </div>
            <div className="pluse-settings-actions">
              <button type="button" className="pluse-button" onClick={() => void saveProject()} disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
            <div className="pluse-settings-danger-zone">
              <h3>危险操作</h3>
              {!confirmDelete ? (
                <button type="button" className="pluse-button pluse-button-danger" onClick={() => setConfirmDelete(true)}>
                  归档项目
                </button>
              ) : (
                <div className="pluse-delete-confirm">
                  <p>此操作会将项目及其所有会话、AI 任务、人类任务和运行数据归档。请输入项目名称 <strong>{overview.project.name}</strong> 确认：</p>
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
                      {deleting ? '归档中…' : '确认归档'}
                    </button>
                    <button type="button" className="pluse-button pluse-button-ghost" onClick={() => { setConfirmDelete(false); setDeleteConfirmName('') }}>
                      取消
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
  onDataChanged: () => Promise<void>
}) {
  const location = useLocation()
  const { questId } = useParams()
  const [quest, setQuest] = useState<Quest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isOverlay = Boolean((location.state as { backgroundLocation?: RouterLocation } | null)?.backgroundLocation)

  useEffect(() => {
    if (!questId) return
    setQuest(null)
    void api.getQuest(questId).then((result) => {
      if (!result.ok) {
        setError(result.error)
        return
      }
      setQuest(result.data)
      onQuestResolved(result.data)
      setError(null)
    })
  }, [questId, onQuestResolved])

  if (!questId) return <Navigate to="/" replace />
  if (error) {
    return isOverlay ? (
      <div className="pluse-modal-backdrop pluse-task-detail-backdrop">
        <section className="pluse-modal-panel pluse-task-detail-modal">
          <div className="pluse-task-detail-loading">
            <p className="pluse-empty-inline">加载失败：{error}</p>
          </div>
        </section>
      </div>
    ) : <div className="pluse-page pluse-page-loading">加载失败：{error}</div>
  }
  if (!quest) {
    return isOverlay ? (
      <div className="pluse-modal-backdrop pluse-task-detail-backdrop">
        <section className="pluse-modal-panel pluse-task-detail-modal">
          <div className="pluse-task-detail-loading">
            <p className="pluse-empty-inline">正在加载任务…</p>
          </div>
        </section>
      </div>
    ) : <div className="pluse-page pluse-page-loading">正在加载内容…</div>
  }

  const handleQuestLoaded = (nextQuest: Quest) => {
    setQuest(nextQuest)
    onQuestResolved(nextQuest)
  }

  return quest.kind === 'task'
    ? <TaskDetail questId={questId} onQuestLoaded={handleQuestLoaded} onDataChanged={onDataChanged} />
    : <ChatView questId={questId} onQuestLoaded={handleQuestLoaded} onDataChanged={onDataChanged} />
}

function WorkspaceHeader(props: {
  activeProject: Project | null
  activeQuest: Quest | null
  theme: ThemeMode
  title?: string
  subtitle?: string | null
  floating?: boolean
  overlayOpen?: boolean
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
  const title = props.title ?? (props.activeQuest
    ? questLabel(props.activeQuest)
    : props.activeProject?.name || 'Pluse')
  const subtitle = props.subtitle ?? (props.activeQuest
    ? props.activeQuest.kind === 'task'
      ? formatOutputStatus(props.activeQuest.status ?? 'idle')
      : props.activeQuest.activeRunId
        ? '运行中'
        : props.activeQuest.followUpQueue.length > 0
          ? `排队 ${props.activeQuest.followUpQueue.length}`
          : null
    : props.activeProject?.workDir
      ? shortPath(props.activeProject.workDir)
      : null)

  return (
    <header className={`pluse-header${props.floating ? ' is-floating' : ''}${props.overlayOpen ? ' has-panel-overlay' : ''}`}>
      <div className="pluse-header-primary">
        <button type="button" className="pluse-icon-button pluse-mobile-only" onClick={props.onToggleSidebar} aria-label="打开侧栏">
          <MenuIcon className="pluse-icon" />
        </button>
        <button type="button" className="pluse-wordmark" onClick={props.onOpenWorkspace}>
          <span>Pluse</span>
        </button>
      </div>

      <div className="pluse-header-center">
        <div className="pluse-header-context">
          <strong>{title}</strong>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
      </div>

      <div className="pluse-header-actions">
        <span className="pluse-header-presence" aria-hidden="true" />
        <button
          type="button"
          className="pluse-icon-button pluse-header-action-icon pluse-theme-toggle"
          onClick={props.onToggleTheme}
          aria-label={props.theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
          title={props.theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
        >
          {props.theme === 'dark' ? <SunIcon className="pluse-icon" /> : <MoonIcon className="pluse-icon" />}
        </button>
        {props.showSettingsToggle ? (
          <button
            type="button"
            className="pluse-icon-button pluse-header-action-icon"
            onClick={props.onOpenSettings}
            aria-label="打开设置"
            title="设置"
          >
            <SettingsIcon className="pluse-icon" />
          </button>
        ) : null}
        {props.showSidebarToggle ? (
          <button
            type="button"
            className={`pluse-icon-button pluse-header-action-icon${props.sidebarVisible ? ' is-active' : ''}`}
            onClick={props.onToggleSidebar}
            aria-label="切换侧栏"
            title="切换侧栏"
          >
            <SidebarIcon className="pluse-icon" />
          </button>
        ) : null}
        {props.showRailToggle ? (
          <button
            type="button"
            className={`pluse-icon-button pluse-header-action-icon pluse-header-rail-toggle${props.railVisible ? ' is-active' : ''}`}
            onClick={props.onToggleRail}
            aria-label="切换任务面板"
            title="切换任务面板"
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

  const activeQuestId = activeQuest?.id ?? (location.pathname.startsWith('/quests/') ? location.pathname.split('/')[2] : null)
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  )

  const isQuestRoute = location.pathname.startsWith('/quests/')
  const isProjectRoute = location.pathname.startsWith('/projects/')
  const isSettingsRoute = location.pathname === '/settings'
  const routeState = location.state as { backgroundLocation?: RouterLocation } | null
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
      navigate(`/projects/${result.data[0].id}`, { replace: true })
    }
  }, [navigate])

  const handleOverviewChanged = useCallback(async () => {
    await loadProjects()
  }, [loadProjects])

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
    if (!activeProjectId) return
    const source = new EventSource(`/api/events?projectId=${encodeURIComponent(activeProjectId)}`)
    source.onmessage = () => {
      void loadProjects()
    }
    source.onerror = () => source.close()
    return () => source.close()
  }, [activeProjectId, loadProjects])

  if (!auth.setupRequired && !auth.authenticated) {
    return <Navigate to="/login" replace />
  }

  if (loading) return <div className="pluse-loading">正在加载 Pluse…</div>
  if (loadError) return (
    <div className="pluse-loading">
      <p>加载失败：{loadError}</p>
      <button type="button" className="pluse-button" onClick={() => { void loadProjects() }}>重试</button>
    </div>
  )

  return (
    <div className="pluse-app-shell">
      <WorkspaceHeader
        activeProject={activeProject}
        activeQuest={activeQuest}
        theme={theme}
        title={isSettingsRoute ? '设置' : undefined}
        subtitle={isSettingsRoute ? '全局系统 Prompt' : undefined}
        floating={!isDesktop && isQuestRoute && isSessionRoute}
        overlayOpen={!isDesktop && (mobileSidebarOpen || mobileRailOpen)}
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
          if (activeProjectId) navigate(`/projects/${activeProjectId}`)
          else navigate('/')
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
          aria-label="关闭面板"
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
              <Route path="/" element={<Navigate to={projects[0] ? `/projects/${projects[0].id}` : '/login'} replace />} />
              <Route
                path="/projects/:projectId"
                element={
                  <ProjectRoute
                    onOverviewLoaded={handleProjectOverviewLoaded}
                    onProjectDeleted={loadProjects}
                  />
                }
              />
              <Route path="/settings" element={<SettingsPage />} />
              <Route
                path="/quests/:questId"
                element={
                  <QuestRoute
                    onQuestResolved={handleQuestResolved}
                    onDataChanged={loadProjects}
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
                      onDataChanged={loadProjects}
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
              activeQuestId={activeQuestId}
              onRequestClose={() => setMobileRailOpen(false)}
              onDataChanged={loadProjects}
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

  if (!auth) return <div className="pluse-loading">正在加载 Pluse…</div>

  return (
    <Routes>
      <Route
        path="/login"
        element={
          auth.authenticated
            ? <Navigate to="/" replace />
            : <LoginPage onAuthenticated={setAuth} theme={theme} onToggleTheme={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} />
        }
      />
      <Route path="/*" element={<Shell auth={auth} theme={theme} onToggleTheme={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} />} />
    </Routes>
  )
}
