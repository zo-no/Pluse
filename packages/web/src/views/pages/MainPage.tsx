import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import type { AuthMe, Project, ProjectOverview, ProjectRecentOutput, Session, Task } from '@melody-sync/types'
import * as api from '@/api/client'
import { ChatView } from '@/views/components/ChatView'
import { ClockIcon, MenuIcon, RailIcon, SidebarIcon, SparkIcon } from '@/views/components/icons'
import { SessionList } from '@/views/components/SessionList'
import { TaskRail } from '@/views/components/TaskRail'
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
  if (normalized === 'blocked') return '等待中'
  return status
}

function scheduleSummary(schedule: ProjectOverview['schedule']): string {
  if (!schedule) return '暂无周期触发'
  if (schedule.lastRunAt && schedule.nextRunAt) {
    return `${formatDateTime(schedule.lastRunAt)} -> ${formatDateTime(schedule.nextRunAt)}`
  }
  if (schedule.nextRunAt) {
    return `下次 ${formatDateTime(schedule.nextRunAt)}`
  }
  if (schedule.lastRunAt) {
    return `最近 ${formatDateTime(schedule.lastRunAt)}`
  }
  return '已配置，未触发'
}

function WorkspaceSection(props: {
  title: string
  hint?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="pulse-detail-section">
      <header className="pulse-detail-section-head">
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

function OutputRow({ output }: { output: ProjectRecentOutput }) {
  const linkTarget = output.sessionId ? `/sessions/${output.sessionId}` : undefined
  const content = (
    <>
      <div className="pulse-output-row-main">
        <div className="pulse-output-row-top">
          <strong>{output.title}</strong>
          <span className={`pulse-task-status is-${String(output.status).toLowerCase()}`}>{formatOutputStatus(output.status)}</span>
        </div>
        <p>{output.summary || (output.kind === 'session_run' ? '该次会话运行已完成，输出可在对应会话里继续查看。' : '该次任务运行已完成。')}</p>
      </div>
      <div className="pulse-output-row-meta">
        <span>{output.kind === 'session_run' ? '会话' : '任务'}</span>
        <span className="pulse-meta-inline">
          <ClockIcon className="pulse-icon pulse-inline-icon" />
          {formatDateTime(output.completedAt)}
        </span>
      </div>
    </>
  )

  if (linkTarget) {
    return <Link className="pulse-output-row" to={linkTarget}>{content}</Link>
  }

  return <div className="pulse-output-row">{content}</div>
}

function ProjectTaskRow({ task }: { task: Task }) {
  return (
    <article className="pulse-task-row">
      <div className="pulse-task-row-main">
        <div className="pulse-task-row-top">
          <strong>{task.title}</strong>
          <span className={`pulse-task-status is-${task.status}`}>{formatOutputStatus(task.status)}</span>
        </div>
        {task.description || task.waitingInstructions ? (
          <p>{task.description || task.waitingInstructions}</p>
        ) : null}
      </div>
      <div className="pulse-task-row-chips">
        <span className="pulse-meta-inline">
          <SparkIcon className="pulse-icon pulse-inline-icon" />
          {task.assignee === 'ai' ? 'AI' : '人工'}
        </span>
        <span className="pulse-meta-inline">
          <ClockIcon className="pulse-icon pulse-inline-icon" />
          {task.kind === 'scheduled' ? '定时' : task.kind === 'recurring' ? '周期' : '单次'}
        </span>
        {!task.enabled ? <span>已暂停</span> : null}
      </div>
    </article>
  )
}

function ProjectPage({ projectId, onProjectLoaded }: { projectId: string; onProjectLoaded: (overview: ProjectOverview) => void }) {
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

  async function toggleBrain() {
    if (!overview) return
    if (!overview.brainTask) {
      const result = await api.createTask({
        projectId,
        title: 'Project Brain',
        description: 'Periodically review the project and propose the next useful work items.',
        assignee: 'ai',
        kind: 'recurring',
        createdBy: 'system',
        scheduleConfig: { kind: 'recurring', cron: '*/30 * * * *' },
        executor: {
          kind: 'ai_prompt',
          agent: 'codex',
          prompt: 'Review the current project state at {workDir}. Summarize the next valuable actions and create any needed Pulse tasks for concrete follow-up work.',
        },
      })
      if (!result.ok) { setError(result.error); return }
    } else {
      const result = await api.updateTask(overview.brainTask.id, { enabled: !overview.brainTask.enabled })
      if (!result.ok) { setError(result.error); return }
    }
    await loadOverview()
  }

  async function handleDeleteProject() {
    if (!overview || deleteConfirmName !== overview.project.name) return
    setDeleting(true)
    const result = await api.deleteProject(projectId)
    setDeleting(false)
    if (!result.ok) { setError(result.error); return }
    navigate('/')
  }

  if (!overview) {
    return <div className="pulse-page pulse-page-loading">正在加载项目…</div>
  }

  return (
    <div className="pulse-page pulse-project-page">
      <div className="pulse-detail-shell">
        <div className="pulse-project-tabs-bar">
          <div className="pulse-project-tab-group">
            <button
              type="button"
              className={`pulse-project-tab${tab === 'overview' ? ' is-active' : ''}`}
              onClick={() => setTab('overview')}
            >
              概览
            </button>
            <button
              type="button"
              className={`pulse-project-tab${tab === 'settings' ? ' is-active' : ''}`}
              onClick={() => setTab('settings')}
            >
              设置
            </button>
          </div>
          <div className="pulse-project-tab-meta">
            <span className="pulse-info-path-sm">{shortPath(overview.project.workDir)}</span>
            {overview.project.pinned ? <span className="pulse-inline-pill">固定</span> : null}
          </div>
        </div>

        {tab === 'overview' ? (
          <div className="pulse-detail-grid">
            <div className="pulse-overview-row">
              <div className="pulse-overview-stat">
                <span>会话</span>
                <strong>{overview.counts.sessions}</strong>
              </div>
              <div className="pulse-overview-stat">
                <span>短期任务</span>
                <strong>{overview.counts.chatShortTasks}</strong>
              </div>
              <div className="pulse-overview-stat">
                <span>项目任务</span>
                <strong>{overview.counts.projectTasks}</strong>
              </div>
              <div className="pulse-overview-stat">
                <span>AI 大脑</span>
                <strong>{overview.brainTask?.enabled ? '运行中' : '未启用'}</strong>
              </div>
              <div className="pulse-overview-stat">
                <span>调度</span>
                <strong className="pulse-overview-stat-sm">{scheduleSummary(overview.schedule)}</strong>
              </div>
            </div>

            {overview.waitingTasks.length > 0 ? (
              <WorkspaceSection title="等待">
                <div className="pulse-note-list">
                  {overview.waitingTasks.map((task) => (
                    <div key={task.id} className="pulse-note-item">
                      <div>
                        <strong>{task.title}</strong>
                        <p>{task.waitingInstructions || task.description || '等待新的输入后再继续。'}</p>
                      </div>
                      <span className={`pulse-task-status is-${task.status}`}>{formatOutputStatus(task.status)}</span>
                    </div>
                  ))}
                </div>
              </WorkspaceSection>
            ) : null}

            <div className="pulse-overview-two-col">
              <WorkspaceSection title="会话">
                {overview.sessions.length > 0 ? (
                  <div className="pulse-session-grid pulse-overview-scroll-list">
                    {overview.sessions.map((session) => (
                      <Link key={session.id} className="pulse-session-row" to={`/sessions/${session.id}`}>
                        <div>
                          <strong>{session.name}</strong>
                          {session.activeRunId ? <p>运行中</p> : null}
                        </div>
                        <span className="pulse-meta-inline">
                          <ClockIcon className="pulse-icon pulse-inline-icon" />
                          {formatDateTime(session.updatedAt)}
                        </span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="pulse-empty-inline">暂无会话</p>
                )}
              </WorkspaceSection>

              <WorkspaceSection title="项目任务">
                {overview.projectTasks.length > 0 ? (
                  <div className="pulse-task-list pulse-overview-scroll-list">
                    {overview.projectTasks.map((task) => (
                      <ProjectTaskRow key={task.id} task={task} />
                    ))}
                  </div>
                ) : (
                  <p className="pulse-empty-inline">暂无项目任务</p>
                )}
              </WorkspaceSection>
            </div>

            {overview.recentOutputs.length > 0 ? (
              <WorkspaceSection title="最近输出">
                <div className="pulse-output-list pulse-output-list-scroll">
                  {overview.recentOutputs.map((output) => (
                    <OutputRow key={`${output.kind}:${output.id}`} output={output} />
                  ))}
                </div>
              </WorkspaceSection>
            ) : null}
          </div>
        ) : (
          <div className="pulse-detail-grid pulse-settings-grid">
            <div className="pulse-form-grid pulse-form-grid-compact">
              <label>
                <span>项目名称</span>
                <input value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="pulse-form-span">
                <span>项目目标</span>
                <textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={2} />
              </label>
              <label className="pulse-form-span">
                <span>系统 Prompt</span>
                <textarea
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  rows={5}
                  placeholder="输入项目级 Prompt，留空则不设置。"
                />
              </label>
            </div>
            <div className="pulse-settings-actions">
              <button type="button" className="pulse-button pulse-button-ghost" onClick={() => void toggleBrain()}>
                {overview.brainTask?.enabled ? '停用 AI 大脑' : '启用 AI 大脑'}
              </button>
              <button type="button" className="pulse-button" onClick={() => void saveProject()} disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
            <div className="pulse-settings-danger-zone">
              <h3>危险操作</h3>
              {!confirmDelete ? (
                <button type="button" className="pulse-button pulse-button-danger" onClick={() => setConfirmDelete(true)}>
                  删除项目
                </button>
              ) : (
                <div className="pulse-delete-confirm">
                  <p>此操作将永久删除项目及其所有会话、任务和数据，不可恢复。请输入项目名称 <strong>{overview.project.name}</strong> 确认：</p>
                  <input
                    type="text"
                    value={deleteConfirmName}
                    onChange={(e) => setDeleteConfirmName(e.target.value)}
                    placeholder={overview.project.name}
                    autoFocus
                  />
                  <div className="pulse-delete-confirm-actions">
                    <button
                      type="button"
                      className="pulse-button pulse-button-danger"
                      onClick={() => void handleDeleteProject()}
                      disabled={deleting || deleteConfirmName !== overview.project.name}
                    >
                      {deleting ? '删除中…' : '确认删除'}
                    </button>
                    <button type="button" className="pulse-button pulse-button-ghost" onClick={() => { setConfirmDelete(false); setDeleteConfirmName('') }}>
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {error ? <p className="pulse-error pulse-detail-error">{error}</p> : null}
      </div>
    </div>
  )
}

function SessionRoute({ onProjectResolved }: { onProjectResolved: (projectId: string, sessionId: string, session: Session) => void }) {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  if (!sessionId) return <Navigate to="/" replace />

  return (
    <ChatView
      sessionId={sessionId}
      onSessionLoaded={(session) => {
        onProjectResolved(session.projectId, session.id, session)
        if (!session.id) navigate('/')
      }}
    />
  )
}

function WorkspaceHeader(props: {
  activeProject: Project | null
  activeSession: Session | null
  sidebarVisible: boolean
  railVisible: boolean
  showSidebarToggle: boolean
  showRailToggle: boolean
  onToggleSidebar: () => void
  onToggleRail: () => void
  onOpenProject: () => void
  onOpenWorkspace: () => void
}) {
  const title = props.activeSession?.name || props.activeProject?.name || 'Pulse'
  const subtitle = props.activeSession?.activeRunId ? '运行中' : null

  return (
    <header className="pulse-header">
      <div className="pulse-header-primary">
        <button type="button" className="pulse-icon-button pulse-mobile-only" onClick={props.onToggleSidebar} aria-label="打开侧栏">
          <MenuIcon className="pulse-icon" />
        </button>
        <button type="button" className="pulse-wordmark" onClick={props.onOpenWorkspace}>
          <span>Pulse</span>
        </button>
      </div>

      <div className="pulse-header-center">
        <div className="pulse-header-context">
          <strong>{title}</strong>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
      </div>

      <div className="pulse-header-actions">
        <span className="pulse-header-presence" aria-hidden="true" />
        {props.showSidebarToggle ? (
          <button
            type="button"
            className={`pulse-icon-button pulse-header-action-icon${props.sidebarVisible ? ' is-active' : ''}`}
            onClick={props.onToggleSidebar}
            aria-label="切换侧栏"
            title="切换侧栏"
          >
            <SidebarIcon className="pulse-icon" />
          </button>
        ) : null}
        {props.showRailToggle ? (
          <button
            type="button"
            className={`pulse-icon-button pulse-header-action-icon pulse-header-rail-toggle${props.railVisible ? ' is-active' : ''}`}
            onClick={props.onToggleRail}
            aria-label="切换任务栏"
            title="切换任务栏"
          >
            <RailIcon className="pulse-icon" />
          </button>
        ) : null}
      </div>
    </header>
  )
}

function Shell({ auth }: { auth: AuthMe }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' ? window.innerWidth >= 861 : true)
  const [desktopSidebarVisible, setDesktopSidebarVisible] = useState(true)
  const [desktopRailVisible, setDesktopRailVisible] = useState(true)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [mobileRailOpen, setMobileRailOpen] = useState(false)

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  )

  const isSessionRoute = location.pathname.startsWith('/sessions/')
  const isProjectRoute = location.pathname.startsWith('/projects/')
  const showRail = isSessionRoute || isProjectRoute
  const sidebarVisible = isDesktop ? desktopSidebarVisible : mobileSidebarOpen
  const railVisible = showRail && (isDesktop ? desktopRailVisible : mobileRailOpen)

  async function loadProjects() {
    const result = await api.getProjects()
    if (!result.ok) { setLoadError(result.error); return }
    setLoadError(null)
    setProjects(result.data)
    if (!activeProjectId && result.data[0]) setActiveProjectId(result.data[0].id)
    if (location.pathname === '/' && result.data[0]) {
      navigate(`/projects/${result.data[0].id}`, { replace: true })
    }
  }

  useEffect(() => {
    void loadProjects().finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    setMobileSidebarOpen(false)
    setMobileRailOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const hasOverlay = mobileSidebarOpen || mobileRailOpen
    document.body.classList.toggle('pulse-overlay-open', hasOverlay)
    return () => document.body.classList.remove('pulse-overlay-open')
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
    const source = new EventSource(`/api/events?projectId=${encodeURIComponent(activeProjectId)}`, { withCredentials: true })
    source.onmessage = () => {
      void loadProjects()
    }
    source.onerror = () => source.close()
    return () => source.close()
  }, [activeProjectId, location.pathname])

  if (!auth.setupRequired && !auth.authenticated) {
    return <Navigate to="/login" replace />
  }

  if (loading) return <div className="pulse-loading">正在加载 Pulse…</div>
  if (loadError) return (
    <div className="pulse-loading">
      <p>加载失败：{loadError}</p>
      <button type="button" className="pulse-button" onClick={() => { void loadProjects() }}>重试</button>
    </div>
  )

  return (
    <div className="pulse-app-shell">
      <WorkspaceHeader
        activeProject={activeProject}
        activeSession={activeSession}
        sidebarVisible={sidebarVisible}
        railVisible={railVisible}
        showSidebarToggle={isDesktop}
        showRailToggle={showRail}
        onToggleSidebar={() => {
          if (isDesktop) setDesktopSidebarVisible((value) => !value)
          else setMobileSidebarOpen((value) => !value)
        }}
        onToggleRail={() => {
          if (isDesktop) setDesktopRailVisible((value) => !value)
          else setMobileRailOpen((value) => !value)
        }}
        onOpenProject={() => {
          if (activeProjectId) navigate(`/projects/${activeProjectId}`)
        }}
        onOpenWorkspace={() => {
          if (activeProjectId) navigate(`/projects/${activeProjectId}`)
          else navigate('/')
        }}
      />

      <div
        className={`pulse-workspace${isProjectRoute ? ' is-project-route' : ''}${isSessionRoute ? ' is-session-route' : ''}`}
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
          className={`pulse-backdrop${mobileSidebarOpen || mobileRailOpen ? ' is-visible' : ''}`}
          onClick={() => {
            setMobileSidebarOpen(false)
            setMobileRailOpen(false)
          }}
          aria-label="关闭面板"
        />

        <div className={`pulse-sidebar-shell${sidebarVisible ? ' is-open' : ''}${isDesktop && !desktopSidebarVisible ? ' is-hidden' : ''}`}>
          <SessionList
            projects={projects}
            activeProjectId={activeProjectId}
            activeSessionId={activeSessionId}
            onProjectsChanged={loadProjects}
            onNavigate={() => setMobileSidebarOpen(false)}
            onRequestClose={() => setMobileSidebarOpen(false)}
          />
        </div>

        <main className="pulse-main-shell">
          <div className="pulse-main">
            <Routes>
              <Route path="/" element={<Navigate to={projects[0] ? `/projects/${projects[0].id}` : '/login'} replace />} />
              <Route
                path="/projects/:projectId"
                element={
                  <ProjectRoute
                    onOverviewLoaded={(overview) => {
                      setActiveProjectId(overview.project.id)
                      setActiveSessionId(null)
                      setActiveSession(null)
                      setProjects((current) => {
                        const hasProject = current.some((project) => project.id === overview.project.id)
                        if (!hasProject) return [...current, overview.project]
                        return current.map((project) => project.id === overview.project.id ? overview.project : project)
                      })
                    }}
                  />
                }
              />
              <Route
                path="/sessions/:sessionId"
                element={
                  <SessionRoute
                    onProjectResolved={(projectId, sessionId, session) => {
                      setActiveProjectId(projectId)
                      setActiveSessionId(sessionId)
                      setActiveSession(session)
                    }}
                  />
                }
              />
            </Routes>
          </div>
        </main>

        {showRail ? (
          <div className={`pulse-rail-shell${railVisible ? ' is-open' : ''}${isDesktop && !desktopRailVisible ? ' is-hidden' : ''}`}>
            <TaskRail
              projectId={activeProjectId}
              projectName={activeProject?.name ?? null}
              sessionId={isSessionRoute ? activeSessionId : null}
              defaultTab={isProjectRoute ? 'Project' : 'Session'}
              onRequestClose={() => setMobileRailOpen(false)}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ProjectRoute({ onOverviewLoaded }: { onOverviewLoaded: (overview: ProjectOverview) => void }) {
  const { projectId } = useParams()
  if (!projectId) return <Navigate to="/" replace />
  return <ProjectPage projectId={projectId} onProjectLoaded={onOverviewLoaded} />
}

export function MainPage() {
  const [auth, setAuth] = useState<AuthMe | null>(null)

  useEffect(() => {
    void api.getAuthMe().then((result) => {
      if (result.ok) setAuth(result.data)
      else setAuth({ authenticated: false, setupRequired: true })
    })
  }, [])

  if (!auth) return <div className="pulse-loading">正在加载 Pulse…</div>

  return (
    <Routes>
      <Route
        path="/login"
        element={
          auth.authenticated
            ? <Navigate to="/" replace />
            : <LoginPage onAuthenticated={setAuth} />
        }
      />
      <Route path="/*" element={<Shell auth={auth} />} />
    </Routes>
  )
}
