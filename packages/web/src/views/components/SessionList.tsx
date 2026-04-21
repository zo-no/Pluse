import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Domain, Project, Quest } from '@pluse/types'
import * as api from '@/api/client'
import { useI18n } from '@/i18n'
import { parseSseMessage } from '@/views/utils/sse'
import { DomainSidebar } from './DomainSidebar'
import { CloseIcon, PlusIcon, SlidersIcon } from './icons'

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
  const { t } = useI18n()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<Quest[]>([])
  const [sidebarTab, setSidebarTab] = useState<'sessions' | 'domains'>('domains')
  const [domains, setDomains] = useState<Domain[]>([])
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projectDir, setProjectDir] = useState('')
  const [projectGoal, setProjectGoal] = useState('')
  const [projectDomainId, setProjectDomainId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  )

  const loadQuests = useCallback(async () => {
    if (!activeProjectId) {
      setSessions([])
      return
    }

    const sessionResult = await api.getQuests({ projectId: activeProjectId, kind: 'session', deleted: false })

    if (sessionResult.ok) setSessions(sessionResult.data)
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
    const source = new EventSource('/api/events')
    let reloadTimer: number | null = null
    source.onmessage = (message) => {
      const event = parseSseMessage(message.data)
      if (!event) return
      if (event.type !== 'domain_updated' && event.type !== 'domain_deleted') return
      if (reloadTimer) window.clearTimeout(reloadTimer)
      reloadTimer = window.setTimeout(() => {
        void loadDomains()
      }, 120)
    }
    source.onerror = () => source.close()
    return () => {
      source.close()
      if (reloadTimer) window.clearTimeout(reloadTimer)
    }
  }, [loadDomains])

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
                      <label>
                        <span className="pluse-sidebar-context-label">{t('领域')}</span>
                        <select value={projectDomainId} onChange={(event) => setProjectDomainId(event.target.value)}>
                          <option value="">{t('未分组')}</option>
                          {domains.map((domain) => (
                            <option key={domain.id} value={domain.id}>{domain.name}</option>
                          ))}
                        </select>
                      </label>
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
        </section>

        <section className="pluse-sidebar-section pluse-sidebar-section-project">
          <div className="pluse-sidebar-header-row pluse-sidebar-project-header">
            <div>
              <h2>{activeProject?.name ?? t('选择项目')}</h2>
              <p>{activeProject ? shortPath(activeProject.workDir) : t('无项目')}</p>
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
        </section>

        {sidebarTab === 'domains' ? (
          <DomainSidebar
            domains={domains}
            projects={projects}
            activeProjectId={activeProjectId}
            onSelectProject={handleSelectProject}
            onProjectsChanged={onProjectsChanged}
            onDomainsChanged={loadDomains}
            onNavigate={onNavigate}
          />
        ) : (
          <>
            <div className="pluse-sidebar-scroll-pane">
              <section className="pluse-sidebar-section pluse-sidebar-section-list">
                <div className="pluse-info-block pluse-session-entry-card">
                  <div className="pluse-sidebar-header-row">
                    <div>
                      <h2>{t('会话')}</h2>
                      <p>{t('当前已经支持在主工作区直接切换会话。')}</p>
                    </div>
                  </div>
                  <div className="pluse-session-entry-summary">
                    <span>{t('当前项目共有 {count} 个会话', { count: sessions.length })}</span>
                    {activeQuestId ? <span>{t('已打开当前会话')}</span> : null}
                  </div>
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
  )
}
