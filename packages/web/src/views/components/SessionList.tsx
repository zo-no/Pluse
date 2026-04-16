import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Project, Session } from '@melody-sync/types'
import * as api from '@/api/client'

interface SessionListProps {
  projects: Project[]
  activeProjectId: string | null
  activeSessionId: string | null
  onProjectsChanged: () => Promise<void>
  onNavigate?: () => void
  onRequestClose?: () => void
}

function shortPath(value?: string | null): string {
  if (!value) return ''
  return value.replace(/^\/Users\/[^/]+/, '~')
}

function formatSidebarTime(value?: string): string {
  if (!value) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function SessionList({
  projects,
  activeProjectId,
  activeSessionId,
  onProjectsChanged,
  onNavigate,
  onRequestClose,
}: SessionListProps) {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<Session[]>([])
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [newSessionName, setNewSessionName] = useState('')
  const [projectName, setProjectName] = useState('')
  const [projectDir, setProjectDir] = useState('')
  const [error, setError] = useState<string | null>(null)

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  )

  useEffect(() => {
    if (!activeProjectId) {
      setSessions([])
      return
    }
    void api.getSessions({ projectId: activeProjectId }).then((result) => {
      if (result.ok) setSessions(result.data)
    })
  }, [activeProjectId])

  async function handleCreateProject(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const result = await api.openProject({ name: projectName || undefined, workDir: projectDir })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setProjectName('')
    setProjectDir('')
    setNewProjectOpen(false)
    await onProjectsChanged()
    onNavigate?.()
    navigate(`/projects/${result.data.id}`)
  }

  async function handleCreateSession() {
    if (!activeProjectId) return
    const result = await api.createSession({
      projectId: activeProjectId,
      name: newSessionName || 'New Session',
    })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setNewSessionName('')
    onNavigate?.()
    navigate(`/sessions/${result.data.id}`)
  }

  return (
    <aside className="pulse-sidebar">
      <div className="pulse-mobile-panel-header">
        <div>
          <span className="pulse-section-kicker">导航</span>
          <strong>工作区</strong>
        </div>
        <button type="button" className="pulse-icon-button" onClick={onRequestClose} aria-label="关闭侧栏">
          ✕
        </button>
      </div>

      <div className="pulse-sidebar-body">
        <section className="pulse-sidebar-section">
          <div className="pulse-sidebar-brand">
            <span className="pulse-section-kicker">工作区</span>
            <strong>{activeProject?.name ?? 'Pulse'}</strong>
            <p>{activeProject ? shortPath(activeProject.workDir) : '项目、会话、任务统一落在同一个项目粒度。'}</p>
          </div>
        </section>

        <section className="pulse-sidebar-section">
          <div className="pulse-sidebar-header-row">
            <div>
              <h2>项目</h2>
              <p>先打开工作目录，再继续会话。</p>
            </div>
            <button type="button" className="pulse-button pulse-button-ghost" onClick={() => setNewProjectOpen((value) => !value)}>
              {newProjectOpen ? '收起' : '打开'}
            </button>
          </div>

          {newProjectOpen ? (
            <form className="pulse-sidebar-form" onSubmit={handleCreateProject}>
              <input
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="项目名称（可选）"
              />
              <input
                value={projectDir}
                onChange={(event) => setProjectDir(event.target.value)}
                placeholder="工作目录，如 ~/projects/xxx"
                required
              />
              <button type="submit" className="pulse-button">打开项目</button>
            </form>
          ) : null}

          <div className="pulse-sidebar-list">
            {projects.map((project) => (
              <Link
                key={project.id}
                className={`pulse-sidebar-item${project.id === activeProjectId ? ' is-active' : ''}`}
                to={`/projects/${project.id}`}
                onClick={onNavigate}
              >
                <div className="pulse-sidebar-item-main">
                  <strong>{project.name}</strong>
                  <p>{project.goal || '继续在这个项目里处理任务与会话。'}</p>
                </div>
                <div className="pulse-sidebar-item-meta">
                  {project.pinned ? <span className="pulse-sidebar-badge">固定</span> : null}
                  <span>{shortPath(project.workDir)}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="pulse-sidebar-section">
          <div className="pulse-sidebar-header-row">
            <div>
              <h2>会话</h2>
              <p>{activeProject ? `当前项目：${activeProject.name}` : '会话跟随当前项目创建'}</p>
            </div>
          </div>

          <div className="pulse-sidebar-form pulse-sidebar-form-inline">
            <input
              value={newSessionName}
              onChange={(event) => setNewSessionName(event.target.value)}
              placeholder="新会话"
              disabled={!activeProjectId}
            />
            <button type="button" className="pulse-button" onClick={() => void handleCreateSession()} disabled={!activeProjectId}>
              新建
            </button>
          </div>

          <div className="pulse-sidebar-list">
            {sessions.length > 0 ? sessions.map((session) => (
              <Link
                key={session.id}
                className={`pulse-sidebar-item pulse-sidebar-session-item${session.id === activeSessionId ? ' is-active' : ''}`}
                to={`/sessions/${session.id}`}
                onClick={onNavigate}
              >
                <div className="pulse-sidebar-item-main">
                  <strong>{session.name}</strong>
                  <p>{session.activeRunId ? '当前有运行中的回合。' : '继续这个会话。'}</p>
                </div>
                <div className="pulse-sidebar-item-meta">
                  {session.activeRunId ? <span className="pulse-sidebar-badge is-running">运行中</span> : null}
                  <span>{formatSidebarTime(session.updatedAt)}</span>
                </div>
              </Link>
            )) : (
              <div className="pulse-empty-state pulse-sidebar-empty">这个项目还没有会话。</div>
            )}
          </div>
        </section>

        {error ? <p className="pulse-error">{error}</p> : null}
      </div>
    </aside>
  )
}
