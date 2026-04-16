import { useEffect, useMemo, useState } from 'react'
import type { Task } from '@melody-sync/types'
import * as api from '@/api/client'

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
    ? '当前会话还没有需要在聊天里持续跟踪的短期任务。'
    : tab === 'Project'
      ? '当前项目还没有项目级调度或周期任务。'
      : '当前项目还没有任务。'

  return (
    <aside className="pulse-rail">
      <div className="pulse-mobile-panel-header">
        <div>
          <span className="pulse-section-kicker">任务地图</span>
          <strong>{projectName || '当前项目'}</strong>
        </div>
        <button type="button" className="pulse-icon-button" onClick={onRequestClose} aria-label="关闭任务栏">
          ✕
        </button>
      </div>

      <div className="pulse-rail-head">
        <div>
          <span className="pulse-section-kicker">工作流</span>
          <h2>{title}</h2>
          <p>{projectName ? `${projectName} · ${tasks.length} 条` : '选择项目后显示任务'}</p>
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
          <article key={task.id} className="pulse-task-card">
            <div className="pulse-task-head">
              <strong>{task.title}</strong>
              <span className={`pulse-task-status is-${task.status}`}>{formatTaskStatus(task.status)}</span>
            </div>
            <p>{task.description || task.waitingInstructions || '暂无补充说明。'}</p>
            <div className="pulse-task-meta">
              <span>{task.assignee === 'ai' ? 'AI' : '人工'}</span>
              <span>{formatTaskKind(task.kind)}</span>
              <span>{task.surface === 'chat_short' ? '会话' : '项目'}</span>
            </div>
            <div className="pulse-task-actions">
              {task.assignee === 'human' && task.status !== 'done' ? (
                <button type="button" className="pulse-button pulse-button-ghost" onClick={() => void handleDone(task.id)}>
                  完成
                </button>
              ) : null}
              {task.assignee === 'ai' && task.status !== 'running' ? (
                <button type="button" className="pulse-button pulse-button-ghost" onClick={() => void handleRun(task.id)}>
                  运行
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
