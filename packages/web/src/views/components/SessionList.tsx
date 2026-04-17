import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Project, Session } from '@melody-sync/types'
import * as api from '@/api/client'
import { ArchiveIcon, ClockIcon, CloseIcon, PinIcon, PlusIcon, TrashIcon } from './icons'

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
  const [archivedSessions, setArchivedSessions] = useState<Session[]>([])
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projectDir, setProjectDir] = useState('')
  const [projectGoal, setProjectGoal] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  )

  async function loadSessions() {
    if (!activeProjectId) { setSessions([]); setArchivedSessions([]); return }
    const [activeResult, archivedResult] = await Promise.all([
      api.getSessions({ projectId: activeProjectId, archived: false }),
      api.getSessions({ projectId: activeProjectId, archived: true }),
    ])
    if (activeResult.ok) setSessions(activeResult.data)
    if (archivedResult.ok) setArchivedSessions(archivedResult.data)
  }

  useEffect(() => { void loadSessions(); setConfirmDeleteId(null) }, [activeProjectId])

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

  // Cancel delete confirm when clicking outside the sidebar
  useEffect(() => {
    if (!confirmDeleteId) return
    function handleClick(event: MouseEvent) {
      if (sidebarRef.current && !sidebarRef.current.contains(event.target as Node)) {
        setConfirmDeleteId(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [confirmDeleteId])

  async function handleCreateProject(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const result = await api.openProject({ name: projectName || undefined, workDir: projectDir, goal: projectGoal || undefined })
    if (!result.ok) { setError(result.error); return }
    setProjectName('')
    setProjectDir('')
    setProjectGoal('')
    setNewProjectOpen(false)
    setProjectPickerOpen(false)
    await onProjectsChanged()
    onNavigate?.()
    navigate(`/projects/${result.data.id}`)
  }

  async function handleCreateSession() {
    if (!activeProjectId) return
    const result = await api.createSession({ projectId: activeProjectId, name: 'New Session' })
    if (!result.ok) { setError(result.error); return }
    onNavigate?.()
    navigate(`/sessions/${result.data.id}`)
  }

  async function handleRename(sessionId: string, name: string) {
    setRenamingId(null)
    if (!name.trim()) return
    const result = await api.updateSession(sessionId, { name: name.trim() })
    if (!result.ok) { setError(result.error); return }
    await loadSessions()
  }

  async function handlePin(sessionId: string, pinned: boolean) {
    const result = await api.updateSession(sessionId, { pinned })
    if (!result.ok) { setError(result.error); return }
    await loadSessions()
  }

  async function handleArchive(sessionId: string) {
    const result = await api.updateSession(sessionId, { archived: true })
    if (!result.ok) { setError(result.error); return }
    if (sessionId === activeSessionId) navigate(activeProjectId ? `/projects/${activeProjectId}` : '/')
    await loadSessions()
  }

  async function handleUnarchive(sessionId: string) {
    const result = await api.updateSession(sessionId, { archived: false })
    if (!result.ok) { setError(result.error); return }
    await loadSessions()
  }

  async function handleDelete(sessionId: string) {
    setDeletingId(sessionId)
    const result = await api.deleteSession(sessionId)
    setDeletingId(null)
    setConfirmDeleteId(null)
    if (!result.ok) { setError(result.error); return }
    if (sessionId === activeSessionId) navigate(activeProjectId ? `/projects/${activeProjectId}` : '/')
    await loadSessions()
  }

  const [searchQuery, setSearchQuery] = useState('')

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return q ? sessions.filter((s) => s.name.toLowerCase().includes(q)) : sessions
  }, [sessions, searchQuery])

  const pinnedSessions = filteredSessions.filter((s) => s.pinned)
  const unpinnedSessions = filteredSessions.filter((s) => !s.pinned)

  function renderSession(session: Session, isArchived = false) {
    if (renamingId === session.id) {
      return (
        <div key={session.id} className="pulse-sidebar-item pulse-sidebar-row pulse-sidebar-rename-row">
          <span className="pulse-sidebar-dot" aria-hidden="true" />
          <input
            ref={renameInputRef}
            className="pulse-sidebar-rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleRename(session.id, renameValue)
              if (e.key === 'Escape') setRenamingId(null)
            }}
            onBlur={() => void handleRename(session.id, renameValue)}
          />
        </div>
      )
    }

    return (
      <div key={session.id} className={`pulse-sidebar-item pulse-sidebar-row${session.id === activeSessionId ? ' is-active' : ''}`}>
        <span className={`pulse-sidebar-dot${session.pinned ? ' is-pinned' : ''}`} aria-hidden="true" />
        <Link
          className="pulse-sidebar-item-main"
          to={`/sessions/${session.id}`}
          onClick={onNavigate}
          onDoubleClick={(e) => {
            e.preventDefault()
            setRenamingId(session.id)
            setRenameValue(session.name)
          }}
        >
          <strong>{session.name}</strong>
          <div className="pulse-sidebar-item-meta">
            {session.activeRunId ? <span className="pulse-sidebar-badge is-running">运行</span> : null}
            <span className="pulse-meta-inline">
              <ClockIcon className="pulse-icon pulse-inline-icon" />
              {formatSidebarTime(session.updatedAt)}
            </span>
          </div>
        </Link>
        <div className="pulse-sidebar-item-actions">
          {!isArchived ? (
            <button
              type="button"
              className={`pulse-sidebar-action-btn${session.pinned ? ' is-active' : ''}`}
              onClick={(e) => { e.preventDefault(); void handlePin(session.id, !session.pinned) }}
              aria-label={session.pinned ? '取消固定' : '固定'}
              title={session.pinned ? '取消固定' : '固定'}
            >
              <PinIcon className="pulse-icon" />
            </button>
          ) : null}
          {isArchived ? (
            <button
              type="button"
              className="pulse-sidebar-action-btn"
              onClick={(e) => { e.preventDefault(); void handleUnarchive(session.id) }}
              aria-label="取消归档"
              title="取消归档"
            >
              <ArchiveIcon className="pulse-icon" />
            </button>
          ) : (
            <button
              type="button"
              className="pulse-sidebar-action-btn"
              onClick={(e) => { e.preventDefault(); void handleArchive(session.id) }}
              aria-label="归档"
              title="归档"
            >
              <ArchiveIcon className="pulse-icon" />
            </button>
          )}
          {confirmDeleteId === session.id ? (
            <>
              <button
                type="button"
                className="pulse-sidebar-action-btn is-danger"
                onClick={(e) => { e.preventDefault(); void handleDelete(session.id) }}
                disabled={deletingId === session.id}
                aria-label="确认删除"
                title="确认删除"
              >
                <TrashIcon className="pulse-icon" />
              </button>
              <button
                type="button"
                className="pulse-sidebar-action-btn"
                onClick={(e) => { e.preventDefault(); setConfirmDeleteId(null) }}
                aria-label="取消"
                title="取消"
              >
                ×
              </button>
            </>
          ) : (
            <button
              type="button"
              className="pulse-sidebar-action-btn is-danger"
              onClick={(e) => { e.preventDefault(); setConfirmDeleteId(session.id) }}
              aria-label="删除"
              title="删除"
            >
              <TrashIcon className="pulse-icon" />
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <aside className="pulse-sidebar" ref={sidebarRef}>
      <div className="pulse-mobile-panel-header">
        <div>
          <span className="pulse-section-kicker">工作区</span>
        </div>
        <button type="button" className="pulse-icon-button" onClick={onRequestClose} aria-label="关闭侧栏">
          <CloseIcon className="pulse-icon" />
        </button>
      </div>

      <div className="pulse-sidebar-body">
        {/* Project switcher */}
        <div className="pulse-project-switcher" ref={pickerRef}>
          <button
            type="button"
            className={`pulse-project-switcher-btn${projectPickerOpen ? ' is-open' : ''}`}
            onClick={() => { setProjectPickerOpen((v) => !v); setNewProjectOpen(false) }}
          >
            <div className="pulse-project-switcher-label">
              <strong>{activeProject?.name ?? '选择项目'}</strong>
              <span>{activeProject ? shortPath(activeProject.workDir) : '无项目'}</span>
            </div>
            <span className="pulse-project-switcher-chevron" aria-hidden="true">⌄</span>
          </button>

          {projectPickerOpen ? (
            <div className="pulse-project-picker">
              <div className="pulse-project-picker-list">
                {projects.map((project) => (
                  <Link
                    key={project.id}
                    className={`pulse-project-picker-item${project.id === activeProjectId ? ' is-active' : ''}`}
                    to={`/projects/${project.id}`}
                    onClick={() => { setProjectPickerOpen(false); onNavigate?.() }}
                  >
                    <span className="pulse-sidebar-dot" aria-hidden="true" />
                    <div className="pulse-project-picker-item-text">
                      <strong>{project.name}</strong>
                      <span>{shortPath(project.workDir)}</span>
                    </div>
                  </Link>
                ))}
              </div>
              <div className="pulse-project-picker-footer">
                {newProjectOpen ? (
                  <form className="pulse-sidebar-form" onSubmit={handleCreateProject}>
                    <input
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      placeholder="项目名称（可选）"
                    />
                    <input
                      value={projectDir}
                      onChange={(e) => setProjectDir(e.target.value)}
                      placeholder="工作目录，如 ~/projects/xxx"
                      required
                    />
                    <textarea
                      value={projectGoal}
                      onChange={(e) => setProjectGoal(e.target.value)}
                      placeholder="项目目标（可选）"
                      rows={2}
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="pulse-button pulse-button-ghost" onClick={() => setNewProjectOpen(false)}>取消</button>
                      <button type="submit" className="pulse-button" style={{ flex: 1 }}>打开</button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    className="pulse-project-picker-add"
                    onClick={() => setNewProjectOpen(true)}
                  >
                    <PlusIcon className="pulse-icon" />
                    添加项目
                  </button>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {/* Search */}
        {sessions.length > 0 && (
          <div className="pulse-sidebar-search">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索会话…"
              className="pulse-sidebar-search-input"
            />
          </div>
        )}

        {/* Session list */}
        <section className="pulse-sidebar-section pulse-sidebar-section-list">
          <div className="pulse-sidebar-list pulse-sidebar-list-dense">
            {pinnedSessions.length > 0 ? pinnedSessions.map((s) => renderSession(s)) : null}
            {unpinnedSessions.length > 0 ? unpinnedSessions.map((s) => renderSession(s)) : null}
            {sessions.length === 0 ? (
              <div className="pulse-empty-state pulse-sidebar-empty">还没有会话</div>
            ) : filteredSessions.length === 0 ? (
              <div className="pulse-empty-state pulse-sidebar-empty">无搜索结果</div>
            ) : null}

            {archivedSessions.length > 0 ? (
              <div className="pulse-sidebar-archive-group">
                <button
                  type="button"
                  className="pulse-sidebar-archive-toggle"
                  onClick={() => setArchivedExpanded((v) => !v)}
                >
                  <span>{archivedExpanded ? '▾' : '▸'} 归档 ({archivedSessions.length})</span>
                </button>
                {archivedExpanded ? (
                  <div className="pulse-sidebar-archive-list">
                    {archivedSessions.map((s) => renderSession(s, true))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        <section className="pulse-sidebar-section-new-session">
          <button
            type="button"
            className="pulse-sidebar-new-session-btn"
            onClick={() => void handleCreateSession()}
            disabled={!activeProjectId}
            aria-label="开始新会话"
            title="开始新会话"
          >
            <PlusIcon className="pulse-icon" />
          </button>
        </section>

        {error ? <p className="pulse-error" style={{ padding: '0 8px 8px' }}>{error}</p> : null}
      </div>

    </aside>
  )
}
