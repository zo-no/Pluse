/**
 * ContextWorkbench — 右侧上下文工作台
 *
 * tabs：进度 / 待办 / 提醒 / 打卡 / 自动化
 * 所有内容均为当前项目/会话级别，头部展示当前项目切换器。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import type { Domain, Project, ProjectPriority } from '@pluse/types'
import * as api from '@/api/client'
import { useI18n } from '@/i18n'
import { useSseEvent } from '@/views/hooks/useSseEvent'
import { RouteIcon } from './icons'
import { TodoPanel } from './TodoPanel'

const PROJECT_PRIORITY_ORDER: ProjectPriority[] = ['mainline', 'priority', 'normal', 'low']

function projectPriorityLabel(priority: ProjectPriority, t: (key: string) => string): string {
  if (priority === 'mainline') return t('主线')
  if (priority === 'priority') return t('优先')
  if (priority === 'low') return t('低优先')
  return t('普通')
}

function sortProjects(list: Project[]): Project[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  })
}

type WorkbenchTab = 'progress' | 'automation'

interface ContextWorkbenchProps {
  projectId: string | null
  projectName?: string | null
  projects: Project[]
  activeQuestId?: string | null
  onSelectProject: (projectId: string | null) => void
  onProjectsChanged: () => Promise<void>
  onRequestClose?: () => void
}

export function ContextWorkbench({
  projectId,
  projectName,
  projects,
  activeQuestId,
  onSelectProject,
  onProjectsChanged,
  onRequestClose,
}: ContextWorkbenchProps) {
  const { t } = useI18n()
  const navigate = useNavigate()

  const [activeTab, setActiveTab] = useState<WorkbenchTab>('progress')
  const prevQuestIdRef = useRef<string | null | undefined>(activeQuestId)
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [expandedPriorityGroups, setExpandedPriorityGroups] = useState<Record<string, boolean>>({})
  const [domains, setDomains] = useState<Domain[]>([])
  const [newProjectModalOpen, setNewProjectModalOpen] = useState(false)
  const [projectName_, setProjectName_] = useState('')
  const [projectDir, setProjectDir] = useState('')
  const [projectGoal, setProjectGoal] = useState('')
  const [projectDomainId, setProjectDomainId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const reloadTimerRef = useRef<number | null>(null)

  const loadDomains = useCallback(async () => {
    const result = await api.getDomains()
    if (result.ok) setDomains(result.data)
  }, [])

  useEffect(() => {
    void loadDomains()
    return () => {
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current)
    }
  }, [loadDomains])

  useSseEvent((event) => {
    if (event.type !== 'domain_updated' && event.type !== 'domain_deleted') return
    if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current)
    reloadTimerRef.current = window.setTimeout(() => { void loadDomains() }, 300)
  })

  // 切换到新会话时自动跳到进度 tab；无会话时若停留在进度 tab 则回退到自动化
  useEffect(() => {
    const prev = prevQuestIdRef.current
    prevQuestIdRef.current = activeQuestId
    if (activeQuestId && activeQuestId !== prev) {
      setActiveTab('progress')
    } else if (!activeQuestId && activeTab === 'progress') {
      setActiveTab('automation')
    }
  }, [activeQuestId, activeTab])

  async function handleCreateProject(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const result = await api.openProject({
      name: projectName_ || undefined,
      workDir: projectDir,
      goal: projectGoal || undefined,
      domainId: projectDomainId || null,
    })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setProjectName_('')
    setProjectDir('')
    setProjectGoal('')
    setProjectDomainId('')
    setNewProjectModalOpen(false)
    await onProjectsChanged()
    navigate(`/projects/${result.data.id}`)
  }

  function handleSelectProject(pid: string | null) {
    onSelectProject(pid)
    setProjectPickerOpen(false)
    setActiveTab('progress')
    if (pid) navigate(`/projects/${pid}`)
    else navigate('/')
  }

  const activeProject = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  )

  const activeDomainName = useMemo(() => {
    if (!activeProject?.domainId) return t('未分组')
    return domains.find((d) => d.id === activeProject.domainId)?.name ?? t('未分组')
  }, [activeProject, domains, t])

  const activeProjectContextLabel = useMemo(() => (
    activeProject
      ? `${projectPriorityLabel(activeProject.priority, t)} · ${activeDomainName}`
      : activeDomainName
  ), [activeDomainName, activeProject, t])

  type ProjectPickerGroup = { key: string; label: string; priority: ProjectPriority; projects: Project[] }
  const projectPickerGroups = useMemo<ProjectPickerGroup[]>(() =>
    PROJECT_PRIORITY_ORDER
      .map((priority) => ({
        key: priority,
        label: projectPriorityLabel(priority, t),
        priority,
        projects: sortProjects(projects.filter((p) => p.priority === priority)),
      }))
      .filter((g) => g.projects.length > 0),
  [projects, t])

  function projectDomainName(project: Project): string {
    if (!project.domainId) return t('未分组')
    return domains.find((d) => d.id === project.domainId)?.name ?? t('未分组')
  }

  return (
    <>
      <aside className="pluse-rail pluse-context-workbench">
        {/* 头部：项目上下文 + tab 控制 */}
        <div className="pluse-rail-head pluse-rail-head-sidebar">
          <div className="pluse-sidebar-project-context pluse-workbench-project-context">
            <div className="pluse-workbench-project-strip">
              <div className="pluse-project-switcher pluse-rail-project-switcher">
                <button
                  type="button"
                  className={`pluse-project-switcher-btn${projectPickerOpen ? ' is-open' : ''}`}
                  onClick={() => setProjectPickerOpen((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={projectPickerOpen}
                >
                  <div className="pluse-project-switcher-label">
                    <strong>{activeProject?.name ?? t('选择项目')}</strong>
                    <span>{activeProjectContextLabel}</span>
                  </div>
                  <span className="pluse-project-switcher-chevron" aria-hidden="true">{projectPickerOpen ? '▴' : '▾'}</span>
                </button>

                {projectPickerOpen ? (
                  <div className="pluse-project-picker">
                    <div className="pluse-project-picker-list" aria-label={t('选择项目')}>
                      <button
                        type="button"
                        className={`pluse-project-picker-item${projectId === null ? ' is-active' : ''}`}
                        onClick={() => handleSelectProject(null)}
                      >
                        <span className="pluse-project-avatar is-compact" aria-hidden="true">☆</span>
                        <div className="pluse-project-picker-item-text">
                          <strong>{t('全部项目')}</strong>
                        </div>
                      </button>
                      {projectPickerGroups.length > 0 ? projectPickerGroups.map((group) => {
                        const groupOpen = expandedPriorityGroups[group.key] ?? (group.priority === 'mainline' || group.priority === 'priority')
                        return (
                          <section key={group.key} className="pluse-project-picker-group">
                            <button
                              type="button"
                              className="pluse-project-picker-group-head"
                              onClick={() => setExpandedPriorityGroups((cur) => ({
                                ...cur,
                                [group.key]: !(cur[group.key] ?? (group.priority === 'mainline' || group.priority === 'priority')),
                              }))}
                            >
                              <strong><span aria-hidden="true">{groupOpen ? '▾' : '▸'}</span> {group.label}</strong>
                              <span>{t('{count} 个项目', { count: group.projects.length })}</span>
                            </button>
                            {groupOpen ? group.projects.map((project) => (
                              <button
                                key={project.id}
                                type="button"
                                className={`pluse-project-picker-item${project.id === projectId ? ' is-active' : ''}`}
                                onClick={() => handleSelectProject(project.id)}
                              >
                                <span className="pluse-project-avatar is-compact" aria-hidden="true">
                                  {project.icon?.trim() || project.name.trim()[0]?.toUpperCase() || '#'}
                                </span>
                                <div className="pluse-project-picker-item-text">
                                  <strong>{project.name}</strong>
                                  <span className="pluse-project-picker-item-meta">
                                    <span>{projectDomainName(project)}</span>
                                    <span className={`pluse-project-priority-badge is-${project.priority}`}>{projectPriorityLabel(project.priority, t)}</span>
                                  </span>
                                </div>
                              </button>
                            )) : null}
                          </section>
                        )
                      }) : (
                        <p className="pluse-domain-empty">{t('暂无项目')}</p>
                      )}
                    </div>
                    <div className="pluse-project-picker-footer">
                      <button
                        type="button"
                        className="pluse-project-picker-add"
                        onClick={() => {
                          setProjectPickerOpen(false)
                          if (projectId) navigate(`/projects/${projectId}`)
                        }}
                        aria-label={t('项目概览')}
                        title={t('项目概览')}
                      >
                        <RouteIcon className="pluse-icon" />
                        <span>{t('项目概览')}</span>
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <div
            className="pluse-sidebar-tabs pluse-sidebar-tabs-vertical pluse-rail-object-tabs"
            role="tablist"
            aria-label={t('上下文工作台')}
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'progress'}
              className={`pluse-sidebar-tab pluse-rail-object-tab${activeTab === 'progress' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('progress')}
              disabled={!activeQuestId}
              aria-disabled={!activeQuestId}
              title={activeQuestId ? undefined : t('进入任一会话后可查看 Progress')}
            >
              {t('进度')}
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'automation'}
              className={`pluse-sidebar-tab pluse-rail-object-tab${activeTab === 'automation' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('automation')}
            >
              {t('自动化')}
            </button>
          </div>
        </div>

        {/* 内容区：进度/待办/提醒/打卡/自动化 */}
        <div className="pluse-workbench-body">
          <TodoPanel
            projectId={projectId}
            projectName={projectName ?? null}
            projects={projects}
            activeQuestId={activeQuestId}
            onRequestClose={onRequestClose}
            onSelectProject={handleSelectProject}
            embedded
            scope="project"
            initialTab={activeTab}
          />
        </div>
      </aside>

      {/* 新建项目 Modal */}
      {newProjectModalOpen ? createPortal(
        <div className="pluse-modal-backdrop" onClick={() => setNewProjectModalOpen(false)}>
          <section
            className="pluse-modal-panel pluse-new-project-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>{t('新建项目')}</h2>
            <form className="pluse-sidebar-form" onSubmit={handleCreateProject}>
              <input
                value={projectName_}
                onChange={(event) => setProjectName_(event.target.value)}
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
                    setProjectName_('')
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
