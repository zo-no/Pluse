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
  const [tab, setTab] = useState<'sessions' | 'projects'>('sessions')
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
          <span className="pulse-section-kicker">任务列表</span>
          <strong>工作区</strong>
        </div>
        <button type="button" className="pulse-icon-button" onClick={onRequestClose} aria-label="关闭侧栏">
          ✕
        </button>
      </div>

      <div className="pulse-sidebar-body">
        <div className="pulse-sidebar-tabs">
          <button
            type="button"
            className={`pulse-sidebar-tab${tab === 'sessions' ? ' is-active' : ''}`}
            onClick={() => setTab('sessions')}
          >
            会话
          </button>
          <button
            type="button"
            className={`pulse-sidebar-tab${tab === 'projects' ? ' is-active' : ''}`}
            onClick={() => setTab('projects')}
          >
            项目
          </button>
        </div>

        {tab === 'sessions' ? (
          <>
            <section className="pulse-sidebar-section pulse-sidebar-section-compact">
              <div className="pulse-sidebar-header-row">
                <div>
                  <h2>{activeProject?.name ?? '当前项目'}</h2>
                  <p>{activeProject ? shortPath(activeProject.workDir) : '先打开项目，再开始会话。'}</p>
                </div>
                {activeProject ? (
                  <Link className="pulse-sidebar-chip-link" to={`/projects/${activeProject.id}`} onClick={onNavigate}>
                    项目
                  </Link>
                ) : null}
              </div>
            </section>

            <section className="pulse-sidebar-section pulse-sidebar-section-compact">
              <div className="pulse-sidebar-composer-row">
                <input
                  value={newSessionName}
                  onChange={(event) => setNewSessionName(event.target.value)}
                  placeholder="开始新会话"
                  disabled={!activeProjectId}
                />
                <button type="button" className="pulse-button" onClick={() => void handleCreateSession()} disabled={!activeProjectId}>
                  开始
                </button>
              </div>
            </section>

            <section className="pulse-sidebar-section pulse-sidebar-section-list">
              <div className="pulse-sidebar-list pulse-sidebar-list-dense">
                {sessions.length > 0 ? sessions.map((session) => (
                  <Link
                    key={session.id}
                    className={`pulse-sidebar-item pulse-sidebar-row${session.id === activeSessionId ? ' is-active' : ''}`}
                    to={`/sessions/${session.id}`}
                    onClick={onNavigate}
                  >
                    <span className="pulse-sidebar-dot" aria-hidden="true" />
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
          </>
        ) : (
          <>
            <section className="pulse-sidebar-section pulse-sidebar-section-compact">
              <div className="pulse-sidebar-header-row">
                <div>
                  <h2>项目</h2>
                  <p>先打开工作目录，再继续会话。</p>
                </div>
                <button type="button" className="pulse-sidebar-chip-link" onClick={() => setNewProjectOpen((value) => !value)}>
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
            </section>

            <section className="pulse-sidebar-section pulse-sidebar-section-list">
              <div className="pulse-sidebar-list pulse-sidebar-list-dense">
                {projects.map((project) => (
                  <Link
                    key={project.id}
                    className={`pulse-sidebar-item pulse-sidebar-row${project.id === activeProjectId ? ' is-active' : ''}`}
                    to={`/projects/${project.id}`}
                    onClick={onNavigate}
                  >
                    <span className="pulse-sidebar-dot" aria-hidden="true" />
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
          </>
        )}

        {error ? <p className="pulse-error">{error}</p> : null}
      </div>
    </aside>
  )
}
