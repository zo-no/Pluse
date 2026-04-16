import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import type { AuthMe, Project, ProjectOverview, ProjectRecentOutput, Session, Task } from '@melody-sync/types'
import * as api from '@/api/client'
import { ChatView } from '@/views/components/ChatView'
import { SessionList } from '@/views/components/SessionList'
import { TaskRail } from '@/views/components/TaskRail'
import { LoginPage } from './LoginPage'

function shortPath(value?: string | null): string {
  if (!value) return ''
  return value.replace(/^\/Users\/[^/]+/, '~')
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
  if (!schedule) return '当前项目还没有启用中的周期触发。'
  if (schedule.lastRunAt && schedule.nextRunAt) {
    return `上次触发 ${formatDateTime(schedule.lastRunAt)}，下次触发 ${formatDateTime(schedule.nextRunAt)}。`
  }
  if (schedule.nextRunAt) {
    return `下次触发 ${formatDateTime(schedule.nextRunAt)}。`
  }
  if (schedule.lastRunAt) {
    return `最近一次触发 ${formatDateTime(schedule.lastRunAt)}。`
  }
  return '已配置调度，但还没有触发记录。'
}

function shortGoal(value?: string | null): string {
  if (!value) return ''
  return value.length > 44 ? `${value.slice(0, 44)}…` : value
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
        <span>{output.kind === 'session_run' ? '会话输出' : '任务输出'}</span>
        <span>{formatDateTime(output.completedAt)}</span>
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
        <p>{task.description || task.waitingInstructions || '暂无补充说明。'}</p>
      </div>
      <div className="pulse-task-row-chips">
        <span className="pulse-inline-pill">{task.kind === 'scheduled' ? '定时' : task.kind === 'recurring' ? '周期' : '单次'}</span>
        <span className="pulse-inline-pill">{task.assignee === 'ai' ? 'AI' : '人工'}</span>
        <span className="pulse-inline-pill">{task.enabled ? '已启用' : '已暂停'}</span>
      </div>
    </article>
  )
}

function ProjectPage({ projectId, onProjectLoaded }: { projectId: string; onProjectLoaded: (overview: ProjectOverview) => void }) {
  const [overview, setOverview] = useState<ProjectOverview | null>(null)
  const [saving, setSaving] = useState(false)
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
    const result = await api.updateProject(projectId, {
      name,
      goal,
      systemPrompt,
    })
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
        surface: 'project',
        visibleInChat: false,
        origin: 'system',
        createdBy: 'system',
        scheduleConfig: {
          kind: 'recurring',
          cron: '*/30 * * * *',
        },
        executor: {
          kind: 'ai_prompt',
          agent: 'codex',
          prompt: 'Review the current project state at {workDir}. Summarize the next valuable actions and create any needed Pulse tasks for concrete follow-up work.',
        },
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
    } else {
      const result = await api.updateTask(overview.brainTask.id, { enabled: !overview.brainTask.enabled })
      if (!result.ok) {
        setError(result.error)
        return
      }
    }
    await loadOverview()
  }

  if (!overview) {
    return <div className="pulse-page pulse-page-loading">正在加载项目…</div>
  }

  return (
    <div className="pulse-page pulse-project-page">
      <div className="pulse-detail-shell">
        <header className="pulse-detail-hero">
          <div className="pulse-detail-hero-main">
            <span className="pulse-section-kicker">长期项目</span>
            <div className="pulse-detail-title-row">
              <h1>{overview.project.name}</h1>
              {overview.project.pinned ? <span className="pulse-inline-pill">固定显示</span> : null}
              <span className="pulse-inline-pill">{overview.brainTask?.enabled ? 'AI 大脑已启用' : 'AI 大脑未启用'}</span>
            </div>
            <p className="pulse-detail-summary">
              {overview.project.goal || '这个项目还没有写目标。建议补一句，让会话和调度器始终对齐同一个方向。'}
            </p>
          </div>
          <div className="pulse-detail-actions">
            <button type="button" className="pulse-button pulse-button-ghost" onClick={() => void toggleBrain()}>
              {overview.brainTask?.enabled ? '停用 AI 大脑' : '启用 AI 大脑'}
            </button>
            <button type="button" className="pulse-button" onClick={() => void saveProject()} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </header>

        <div className="pulse-detail-grid">
          <WorkspaceSection title="工作目录" hint="项目身份固定绑定在这个目录里，当前只读展示。">
            <div className="pulse-info-block">
              <div className="pulse-info-path">{shortPath(overview.project.workDir)}</div>
              <div className="pulse-info-copy">{overview.project.workDir}</div>
            </div>
            <div className="pulse-form-grid">
              <label>
                <span>项目名称</span>
                <input value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="pulse-form-span">
                <span>项目目标</span>
                <textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={4} />
              </label>
            </div>
          </WorkspaceSection>

          <WorkspaceSection title="统计" hint="所有会话、短期任务和项目级调度都落在同一个 projectId 下。">
            <div className="pulse-metric-grid">
              <article className="pulse-metric-item">
                <span>会话</span>
                <strong>{overview.counts.sessions}</strong>
              </article>
              <article className="pulse-metric-item">
                <span>短期任务</span>
                <strong>{overview.counts.chatShortTasks}</strong>
              </article>
              <article className="pulse-metric-item">
                <span>项目任务</span>
                <strong>{overview.counts.projectTasks}</strong>
              </article>
            </div>
          </WorkspaceSection>

          <WorkspaceSection title="调度 / 触发" hint="优先展示 Project Brain，没有时回退到第一个启用中的周期或定时任务。">
            <div className="pulse-trigger-row">
              <div className="pulse-trigger-item">
                <span>当前触发器</span>
                <strong>{overview.brainTask?.enabled ? 'Project Brain' : overview.schedule ? '项目调度任务' : '未配置'}</strong>
              </div>
              <div className="pulse-trigger-item">
                <span>调度状态</span>
                <strong>{scheduleSummary(overview.schedule)}</strong>
              </div>
            </div>
          </WorkspaceSection>

          <WorkspaceSection title="等待中事项" hint="这里展示显式 blocked 或带等待说明的项目级任务。">
            <div className="pulse-note-list">
              {overview.waitingTasks.length > 0 ? overview.waitingTasks.map((task) => (
                <div key={task.id} className="pulse-note-item">
                  <div>
                    <strong>{task.title}</strong>
                    <p>{task.waitingInstructions || task.description || '等待新的输入后再继续。'}</p>
                  </div>
                  <span className={`pulse-task-status is-${task.status}`}>{formatOutputStatus(task.status)}</span>
                </div>
              )) : (
                <div className="pulse-empty-state">暂无等待中的项目级事项。</div>
              )}
            </div>
          </WorkspaceSection>

          <WorkspaceSection title="项目任务" hint="周期任务和调度任务只在项目页展示，不混进会话右栏。">
            <div className="pulse-task-list">
              {overview.projectTasks.length > 0 ? overview.projectTasks.map((task) => (
                <ProjectTaskRow key={task.id} task={task} />
              )) : (
                <div className="pulse-empty-state">这个项目还没有项目级任务。</div>
              )}
            </div>
          </WorkspaceSection>

          <WorkspaceSection title="最近输出" hint="会话运行和任务运行会混合成一条最近输出时间线。">
            <div className="pulse-output-list">
              {overview.recentOutputs.length > 0 ? overview.recentOutputs.map((output) => (
                <OutputRow key={`${output.kind}:${output.id}`} output={output} />
              )) : (
                <div className="pulse-empty-state">还没有可回看的运行输出。</div>
              )}
            </div>
          </WorkspaceSection>

          <WorkspaceSection
            title="系统 Prompt / AI 大脑"
            hint="项目级 Prompt 会注入到会话和调度流程里，AI 大脑负责周期复盘。"
            action={overview.brainTask ? <span className="pulse-inline-pill">{overview.brainTask.enabled ? '运行中' : '已暂停'}</span> : null}
          >
            <div className="pulse-form-grid">
              <label className="pulse-form-span">
                <span>系统 Prompt</span>
                <textarea
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  rows={10}
                  placeholder="输入项目级 Prompt，留空则不设置。"
                />
              </label>
            </div>
          </WorkspaceSection>

          <WorkspaceSection title="会话列表" hint="这些会话共享同一个项目上下文和工作目录。">
            <div className="pulse-session-grid">
              {overview.sessions.length > 0 ? overview.sessions.map((session) => (
                <Link key={session.id} className="pulse-session-row" to={`/sessions/${session.id}`}>
                  <div>
                    <strong>{session.name}</strong>
                    <p>{session.activeRunId ? '当前有运行中的回合。' : '打开这个会话继续处理。'}</p>
                  </div>
                  <span>{formatDateTime(session.updatedAt)}</span>
                </Link>
              )) : (
                <div className="pulse-empty-state">这个项目还没有会话。</div>
              )}
            </div>
          </WorkspaceSection>
        </div>

        {error ? <p className="pulse-error">{error}</p> : null}
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
  const subtitle = props.activeSession
    ? `${props.activeProject?.name ?? props.activeSession.projectId} · ${props.activeSession.activeRunId ? '运行中' : '会话'}`
    : props.activeProject
      ? (shortGoal(props.activeProject.goal) || shortPath(props.activeProject.workDir))
      : '单端口本地工作区'

  return (
    <header className="pulse-header">
      <div className="pulse-header-primary">
        <button type="button" className="pulse-icon-button pulse-mobile-only" onClick={props.onToggleSidebar} aria-label="打开侧栏">
          ☰
        </button>
        <button type="button" className="pulse-wordmark" onClick={props.onOpenWorkspace}>
          <span>Pulse</span>
          <small>本地工作台</small>
        </button>
      </div>

      <div className="pulse-header-center">
        <div className="pulse-header-context">
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
      </div>

      <div className="pulse-header-actions">
        {props.showSidebarToggle ? (
          <button
            type="button"
            className={`pulse-header-action${props.sidebarVisible ? ' is-active' : ''}`}
            onClick={props.onToggleSidebar}
          >
            侧栏
          </button>
        ) : null}
        <span className="pulse-status-pill">本地</span>
        {props.activeProject && props.activeSession ? (
          <button type="button" className="pulse-header-action" onClick={props.onOpenProject}>
            项目
          </button>
        ) : null}
        {props.showRailToggle ? (
          <button
            type="button"
            className={`pulse-header-action pulse-header-rail-toggle${props.railVisible ? ' is-active' : ''}`}
            onClick={props.onToggleRail}
          >
            任务
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
  const sidebarVisible = isDesktop ? desktopSidebarVisible : mobileSidebarOpen
  const railVisible = isSessionRoute && (isDesktop ? desktopRailVisible : mobileRailOpen)

  async function loadProjects() {
    const result = await api.getProjects()
    if (!result.ok) return
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

  return (
    <div className="pulse-app-shell">
      <WorkspaceHeader
        activeProject={activeProject}
        activeSession={activeSession}
        sidebarVisible={sidebarVisible}
        railVisible={railVisible}
        showSidebarToggle={isDesktop}
        showRailToggle={isSessionRoute}
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
        className={`pulse-workspace${isProjectRoute ? ' is-project-route' : ''}`}
        style={isDesktop
          ? {
              gridTemplateColumns: isSessionRoute
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

        {isSessionRoute ? (
          <div className={`pulse-rail-shell${railVisible ? ' is-open' : ''}${isDesktop && !desktopRailVisible ? ' is-hidden' : ''}`}>
            <TaskRail
              projectId={activeProjectId}
              projectName={activeProject?.name ?? null}
              sessionId={activeSessionId}
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
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={<Shell auth={auth} />} />
    </Routes>
  )
}
