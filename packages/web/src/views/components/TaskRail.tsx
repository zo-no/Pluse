import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Task } from '@pluse/types'
import * as api from '@/api/client'
import { CheckIcon, CloseIcon, PlayIcon, RailIcon } from './icons'
import { TaskDetail } from './TaskDetail'

type RailTab = 'Session' | 'Project' | 'All'

interface TaskRailProps {
  projectId: string | null
  projectName?: string | null
  sessionId: string | null
  defaultTab?: RailTab
  onRequestClose?: () => void
}

function formatTaskKind(value: Task['kind']): string {
  if (value === 'recurring') return '周期'
  if (value === 'scheduled') return '定时'
  return '单次'
}

function formatTaskStatus(value: Task['status']): string {
  if (value === 'pending') return '待处理'
  if (value === 'running') return '运行中'
  if (value === 'done') return '已完成'
  if (value === 'failed') return '失败'
  if (value === 'cancelled') return '已取消'
  if (value === 'blocked') return '等待中'
  return value
}

export function TaskRail({ projectId, projectName, sessionId, defaultTab = 'Session', onRequestClose }: TaskRailProps) {
  const [tab, setTab] = useState<RailTab>(defaultTab)
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function loadTasks() {
    if (!projectId) {
      setTasks([])
      return
    }

    if (tab === 'Session' && !sessionId) {
      setTasks([])
      return
    }

    const params = tab === 'Session'
      ? { projectId, sessionId: sessionId ?? undefined }
      : { projectId }

    const result = await api.getTasks(params)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setTasks(result.data)
    setError(null)
  }

  useEffect(() => {
    void loadTasks()
  }, [projectId, sessionId, tab])

  useEffect(() => {
    if (!projectId) return
    const query = sessionId
      ? `?projectId=${encodeURIComponent(projectId)}&sessionId=${encodeURIComponent(sessionId)}`
      : `?projectId=${encodeURIComponent(projectId)}`
    const source = new EventSource(`/api/events${query}`, { withCredentials: true })
    source.onmessage = () => { void loadTasks() }
    return () => source.close()
  }, [projectId, sessionId])

  useEffect(() => {
    setSelectedTaskId(null)
  }, [tab, sessionId, projectId])

  async function handleDone(taskId: string) {
    const result = await api.completeTask(taskId)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await loadTasks()
  }

  async function handleRun(taskId: string) {
    const result = await api.runTask(taskId)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await loadTasks()
  }

  const title = useMemo(() => {
    if (tab === 'Session') return '会话任务'
    if (tab === 'Project') return '项目任务'
    return '全部任务'
  }, [tab])

  function tabLabel(value: RailTab): string {
    if (value === 'Session') return '会话'
    if (value === 'Project') return '项目'
    return '全部'
  }

  const emptyCopy = tab === 'Session'
    ? '暂无会话任务'
    : tab === 'Project'
      ? '暂无项目任务'
      : '暂无任务'

  const selectedTask = selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) ?? null : null

  return (
    <aside className="pluse-rail">
      <div className="pluse-rail-list-pane">
        <div className="pluse-mobile-panel-header">
          <div>
            <span className="pluse-section-kicker">任务地图</span>
            <strong>{projectName || '当前项目'}</strong>
          </div>
          <button type="button" className="pluse-icon-button" onClick={onRequestClose} aria-label="关闭任务栏">
            <CloseIcon className="pluse-icon" />
          </button>
        </div>

        <div className="pluse-rail-head">
          <div className="pluse-rail-head-row">
            <div className="pluse-rail-head-info">
              <span className="pluse-rail-mark" aria-hidden="true">
                <RailIcon className="pluse-icon" />
              </span>
              <span className="pluse-rail-head-label">{projectName ? `${projectName} · ${tasks.length}` : title}</span>
            </div>
            <div className="pluse-tabs">
              {(['Session', 'Project', 'All'] as RailTab[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`pluse-tab${tab === value ? ' is-active' : ''}`}
                  onClick={() => setTab(value)}
                >
                  {tabLabel(value)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="pluse-task-list">
          {tasks.length > 0 ? tasks.map((task) => (
            <article
              key={task.id}
              className={`pluse-task-card pluse-task-compact${selectedTaskId === task.id ? ' is-selected' : ''}`}
              onClick={() => setSelectedTaskId(selectedTaskId === task.id ? null : task.id)}
            >
              <div className="pluse-task-compact-row">
                <div className="pluse-task-compact-main">
                  <strong>{task.title}</strong>
                  {task.assignee === 'human' && task.waitingInstructions && (
                    <p className="pluse-task-compact-hint">{task.waitingInstructions}</p>
                  )}
                  <div className="pluse-task-compact-meta">
                    <span className={`pluse-task-status is-${task.status}`}>{formatTaskStatus(task.status)}</span>
                    <span className="pluse-meta-dot">·</span>
                    <span className="pluse-meta-inline">{task.assignee === 'ai' ? 'AI' : '人工'}</span>
                    <span className="pluse-meta-dot">·</span>
                    <span className="pluse-meta-inline">{formatTaskKind(task.kind)}</span>
                  </div>
                </div>
                <div className="pluse-task-compact-actions" onClick={(e) => e.stopPropagation()}>
                  {task.assignee === 'human' && task.status !== 'done' ? (
                    <button type="button" className="pluse-row-action" onClick={() => void handleDone(task.id)} aria-label="完成任务" title="完成任务">
                      <CheckIcon className="pluse-icon" />
                    </button>
                  ) : null}
                  {task.assignee === 'ai' && task.status !== 'running' ? (
                    <button type="button" className="pluse-row-action" onClick={() => void handleRun(task.id)} aria-label="运行任务" title="运行任务">
                      <PlayIcon className="pluse-icon" />
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          )) : (
            <div className="pluse-empty-state pluse-rail-empty">{emptyCopy}</div>
          )}
        </div>

        {error ? <p className="pluse-error">{error}</p> : null}
      </div>

      {selectedTask && createPortal(
        <div className="pluse-modal-backdrop" onClick={() => setSelectedTaskId(null)}>
          <div className="pluse-modal-panel" onClick={(e) => e.stopPropagation()}>
            <TaskDetail
              task={selectedTask}
              allTasks={tasks}
              onClose={() => setSelectedTaskId(null)}
              onRefresh={() => void loadTasks()}
              onDeleted={() => { setSelectedTaskId(null); void loadTasks() }}
            />
          </div>
        </div>,
        document.body,
      )}
    </aside>
  )
}
