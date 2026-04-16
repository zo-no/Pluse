import { useEffect, useMemo, useState } from 'react'
import type { Task } from '@melody-sync/types'
import * as api from '@/api/client'
import { CheckIcon, ClockIcon, CloseIcon, PlayIcon, RailIcon, SparkIcon } from './icons'

type RailTab = 'Session' | 'Project' | 'All'

interface TaskRailProps {
  projectId: string | null
  projectName?: string | null
  sessionId: string | null
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

export function TaskRail({ projectId, projectName, sessionId, onRequestClose }: TaskRailProps) {
  const [tab, setTab] = useState<RailTab>('Session')
  const [tasks, setTasks] = useState<Task[]>([])
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
      ? { projectId, sessionId: sessionId ?? undefined, surface: 'chat_short', visibleInChat: true }
      : tab === 'Project'
        ? { projectId, surface: 'project' }
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
    source.onerror = () => source.close()
    return () => source.close()
  }, [projectId, sessionId, tab])

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

  return (
    <aside className="pulse-rail">
      <div className="pulse-mobile-panel-header">
        <div>
          <span className="pulse-section-kicker">任务地图</span>
          <strong>{projectName || '当前项目'}</strong>
        </div>
        <button type="button" className="pulse-icon-button" onClick={onRequestClose} aria-label="关闭任务栏">
          <CloseIcon className="pulse-icon" />
        </button>
      </div>

      <div className="pulse-rail-head">
        <div className="pulse-rail-title">
          <span className="pulse-rail-mark" aria-hidden="true">
            <RailIcon className="pulse-icon" />
          </span>
          <div>
            <h2>{title}</h2>
            <p>{projectName ? `${projectName} · ${tasks.length}` : '选择项目后显示任务'}</p>
          </div>
        </div>
        <div className="pulse-tabs">
          {(['Session', 'Project', 'All'] as RailTab[]).map((value) => (
            <button
              key={value}
              type="button"
              className={`pulse-tab${tab === value ? ' is-active' : ''}`}
              onClick={() => setTab(value)}
            >
              {tabLabel(value)}
            </button>
          ))}
        </div>
      </div>

      <div className="pulse-task-list">
        {tasks.length > 0 ? tasks.map((task) => (
          <article key={task.id} className="pulse-task-card pulse-task-line">
            <div className="pulse-task-head">
              <strong>{task.title}</strong>
              <span className={`pulse-task-status is-${task.status}`}>{formatTaskStatus(task.status)}</span>
            </div>
            {task.description || task.waitingInstructions ? (
              <p>{task.description || task.waitingInstructions}</p>
            ) : null}
            <div className="pulse-task-meta">
              <span className="pulse-meta-inline">
                <SparkIcon className="pulse-icon pulse-inline-icon" />
                {task.assignee === 'ai' ? 'AI' : '人工'}
              </span>
              <span className="pulse-meta-inline">
                <ClockIcon className="pulse-icon pulse-inline-icon" />
                {formatTaskKind(task.kind)}
              </span>
              <span>{task.surface === 'chat_short' ? '会话' : '项目'}</span>
            </div>
            <div className="pulse-task-actions">
              {task.assignee === 'human' && task.status !== 'done' ? (
                <button type="button" className="pulse-row-action" onClick={() => void handleDone(task.id)} aria-label="完成任务" title="完成任务">
                  <CheckIcon className="pulse-icon" />
                </button>
              ) : null}
              {task.assignee === 'ai' && task.status !== 'running' ? (
                <button type="button" className="pulse-row-action" onClick={() => void handleRun(task.id)} aria-label="运行任务" title="运行任务">
                  <PlayIcon className="pulse-icon" />
                </button>
              ) : null}
            </div>
          </article>
        )) : (
          <div className="pulse-empty-state pulse-rail-empty">{emptyCopy}</div>
        )}
      </div>

      {error ? <p className="pulse-error">{error}</p> : null}
    </aside>
  )
}
