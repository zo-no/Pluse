import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Project, Session } from '@melody-sync/types'
import * as api from '@/api/client'
import { ClockIcon, CloseIcon, FolderIcon, PlusIcon } from './icons'

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
  const normalized = value.replace(/^\/Users\/[^/]+/, '~')
  const isHome = normalized.startsWith('~/')
  const parts = normalized.replace(/^~\//, '').replace(/^\//, '').split('/').filter(Boolean)
  if (parts.length <= 3) return normalized
  return `${isHome ? '~/' : '/'}${parts.slice(0, 2).join('/')}/…/${parts.slice(-2).join('/')}`
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

function shortGoal(value?: string | null): string {
  if (!value) return ''
  return value.length > 28 ? `${value.slice(0, 28)}…` : value
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
          <CloseIcon className="pulse-icon" />
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
                  <p>{activeProject ? shortPath(activeProject.workDir) : '先打开项目'}</p>
                </div>
                {activeProject ? (
                  <Link className="pulse-sidebar-chip-link pulse-sidebar-icon-chip" to={`/projects/${activeProject.id}`} onClick={onNavigate} aria-label="打开项目">
                    <FolderIcon className="pulse-icon" />
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
                      <div className="pulse-sidebar-item-meta">
                        {session.activeRunId ? <span className="pulse-sidebar-badge is-running">运行</span> : null}
                        <span className="pulse-meta-inline">
                          <ClockIcon className="pulse-icon pulse-inline-icon" />
                          {formatSidebarTime(session.updatedAt)}
                        </span>
                      </div>
                    </div>
                  </Link>
                )) : (
                  <div className="pulse-empty-state pulse-sidebar-empty">还没有会话</div>
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
                  <p>工作目录</p>
                </div>
                <button type="button" className="pulse-sidebar-chip-link pulse-sidebar-icon-chip" onClick={() => setNewProjectOpen((value) => !value)} aria-label={newProjectOpen ? '收起创建项目' : '打开创建项目'}>
                  <PlusIcon className="pulse-icon" />
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
                      <div className="pulse-sidebar-item-meta">
                        {project.pinned ? <span className="pulse-sidebar-badge">固定</span> : null}
                        <span>{shortGoal(project.goal) || shortPath(project.workDir)}</span>
                      </div>
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
