/**
 * ContextWorkbench — 右侧上下文工作台
 *
 * 统一 tab 层级：
 *   项目     — DomainSidebar（项目选择器）
 *   进度     — 当前会话 Pluse Plan 流水
 *   待办     — 项目/全局待办
 *   提醒     — 全局提醒
 *   打卡     — 全局打卡
 *   自动化   — 当前项目自动化任务
 *
 * TodoPanel(embedded) 负责"进度/待办/提醒/打卡/自动化"五个 tab 的内容渲染，
 * ContextWorkbench 统一管理外层 tab 按钮，通过 initialTab 驱动 TodoPanel 切换。
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import type { Domain, Project } from '@pluse/types'
import * as api from '@/api/client'
import { useI18n } from '@/i18n'
import { useSseEvent } from '@/views/hooks/useSseEvent'
import { PlusIcon } from './icons'
import { DomainSidebar } from './DomainSidebar'
import { TodoPanel } from './TodoPanel'

type WorkbenchTab = 'projects' | 'progress' | 'human' | 'reminder' | 'check_in' | 'automation'

interface ContextWorkbenchProps {
  projectId: string | null
  projectName?: string | null
  projects: Project[]
  activeQuestId?: string | null
  onSelectProject: (projectId: string) => void
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

  const [activeTab, setActiveTab] = useState<WorkbenchTab>('projects')
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

  // 切换会话时自动跳到进度 tab
  useEffect(() => {
    if (activeQuestId) setActiveTab('progress')
  }, [activeQuestId])

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

  function handleSelectProject(pid: string) {
    onSelectProject(pid)
    setActiveTab('progress')
  }

  // TodoPanel embedded 模式下 initialTab 映射
  const todoInitialTab = activeTab === 'progress' ? 'progress'
    : activeTab === 'reminder' ? 'reminder'
    : activeTab === 'check_in' ? 'check_in'
    : activeTab === 'automation' ? 'automation'
    : 'human'

  return (
    <>
      <aside className="pluse-rail pluse-context-workbench">
        {/* 头部：统一 tab 控制层 */}
        <div className="pluse-rail-head pluse-rail-head-sidebar">
          <div className="pluse-sidebar-project-context pluse-workbench-project-context">
            <div className="pluse-workbench-project-strip">
              <div className="pluse-workbench-project-copy">
                <strong>{projectName || t('当前项目')}</strong>
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
              aria-selected={activeTab === 'projects'}
              className={`pluse-sidebar-tab pluse-rail-object-tab${activeTab === 'projects' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('projects')}
            >
              {t('项目')}
            </button>
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
              aria-selected={activeTab === 'human'}
              className={`pluse-sidebar-tab pluse-rail-object-tab${activeTab === 'human' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('human')}
            >
              {t('待办')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'reminder'}
              className={`pluse-sidebar-tab pluse-rail-object-tab${activeTab === 'reminder' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('reminder')}
            >
              {t('提醒')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'check_in'}
              className={`pluse-sidebar-tab pluse-rail-object-tab${activeTab === 'check_in' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('check_in')}
            >
              {t('打卡')}
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
          <div className="pluse-rail-content-divider" aria-hidden="true" />
        </div>

        {/* 内容区 */}
        <div className="pluse-workbench-body">
          {activeTab === 'projects' ? (
            <DomainSidebar
              domains={domains}
              projects={projects}
              activeProjectId={projectId}
              onSelectProject={handleSelectProject}
              onProjectsChanged={onProjectsChanged}
              onDomainsChanged={loadDomains}
              onCreateProject={() => setNewProjectModalOpen(true)}
              onNavigate={onRequestClose}
            />
          ) : (
            /* 进度/待办/提醒/打卡/自动化 — 由 TodoPanel embedded 统一承载 */
            <TodoPanel
              projectId={projectId}
              projectName={projectName ?? null}
              projects={projects}
              activeQuestId={activeQuestId}
              onRequestClose={onRequestClose}
              onSelectProject={handleSelectProject}
              embedded
              initialTab={todoInitialTab}
            />
          )}
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
