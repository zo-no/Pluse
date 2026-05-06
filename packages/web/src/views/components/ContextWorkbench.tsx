/**
 * ContextWorkbench — 右侧上下文工作台
 *
 * tabs：进度 / 自动化
 */
import { useEffect, useRef, useState } from 'react'
import type { Project } from '@pluse/types'
import { useI18n } from '@/i18n'
import { TodoPanel } from './TodoPanel'

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
  onRequestClose,
}: ContextWorkbenchProps) {
  const { t } = useI18n()

  const [activeTab, setActiveTab] = useState<WorkbenchTab>('progress')
  const prevQuestIdRef = useRef<string | null | undefined>(activeQuestId)

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

  function handleSelectProject(pid: string | null) {
    onSelectProject(pid)
  }

  return (
    <aside className="pluse-rail pluse-context-workbench">
      {/* 头部：tab 控制 */}
      <div className="pluse-rail-head pluse-rail-head-sidebar">
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

      {/* 内容区：进度 / 自动化 */}
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
  )
}
