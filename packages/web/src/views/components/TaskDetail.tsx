import { useEffect, useState } from 'react'
import type { Task, TaskLog, TaskOp, TaskRun } from '@pluse/types'
import * as api from '@/api/client'
import { CloseIcon, PlayIcon, CheckIcon } from './icons'

interface TaskDetailProps {
  task: Task
  allTasks: Task[]
  onClose: () => void
  onRefresh: () => void
  onDeleted: () => void
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

function formatStatus(status: string): string {
  const map: Record<string, string> = {
    pending: '待处理', running: '运行中', done: '已完成',
    failed: '失败', cancelled: '已取消', blocked: '等待中',
    success: '成功', skipped: '已跳过',
  }
  return map[status] ?? status
}

function formatOp(op: string): string {
  const map: Record<string, string> = {
    created: '已创建', triggered: '已触发', status_changed: '状态变更',
    done: '已完成', cancelled: '已取消', review_created: '创建审核任务',
    unblocked: '已解除阻塞', deleted: '已删除',
  }
  return map[op] ?? op
}

type Tab = 'info' | 'history' | 'ops'

export function TaskDetail({ task, allTasks, onClose, onRefresh, onDeleted }: TaskDetailProps) {
  const [tab, setTab] = useState<Tab>(() =>
    task.assignee === 'ai' && task.status === 'running' ? 'history' : 'info'
  )
  const [runs, setRuns] = useState<TaskRun[]>([])
  const [logs, setLogs] = useState<TaskLog[]>([])
  const [ops, setOps] = useState<TaskOp[]>([])
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const [doneExpanded, setDoneExpanded] = useState(false)
  const [doneOutput, setDoneOutput] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (task.assignee === 'ai' && task.status === 'running') setTab('history')
  }, [task.status, task.assignee])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 4000)
    return () => clearTimeout(t)
  }, [error])

  useEffect(() => {
    void api.getTaskOps(task.id).then((r) => { if (r.ok) setOps(r.data) })
    void api.getTaskLogs(task.id).then((r) => { if (r.ok) setLogs(r.data) })
    if (task.assignee === 'ai') {
      void api.getTaskRuns(task.id).then((r) => {
        if (!r.ok) return
        setRuns(r.data)
        const active = r.data.find((run) => run.status === 'running')
        if (active) setExpandedRunId(active.id)
      })
    }
  }, [task.id, task.updatedAt, task.assignee])

  const blockedByTask = task.blockedByTaskId ? allTasks.find((t) => t.id === task.blockedByTaskId) : null

  async function handleRun() {
    const result = await api.runTask(task.id)
    if (!result.ok) { setError(result.error); return }
    setTab('history')
    onRefresh()
    setTimeout(() => onRefresh(), 1200)
  }

  async function handleDone() {
    const result = await api.completeTask(task.id, doneOutput || undefined)
    if (!result.ok) { setError(result.error); return }
    setDoneExpanded(false)
    setDoneOutput('')
    setToast('已标记完成')
    onRefresh()
  }

  async function handleToggleEnabled() {
    const result = await api.updateTask(task.id, { enabled: !task.enabled })
    if (!result.ok) { setError(result.error); return }
    onRefresh()
  }

  async function handleDeleteConfirmed() {
    const result = await api.deleteTask(task.id)
    if (!result.ok) { setError(result.error); return }
    onDeleted()
  }

  const tabs: Tab[] = task.assignee === 'ai' ? ['info', 'history', 'ops'] : ['info', 'ops']
  const tabLabel: Record<Tab, string> = { info: '信息', history: '历史', ops: '日志' }

  return (
    <div className="pluse-task-detail">
      {/* Header */}
      <div className="pluse-task-detail-header">
        <div className="pluse-task-detail-title">
          <h3>{task.title}</h3>
          <div className="pluse-task-detail-meta">
            <span className={`pluse-task-status is-${task.status}`}>{formatStatus(task.status)}</span>
            <span className="pluse-assignee-tag" data-assignee={task.assignee}>
              {task.assignee === 'ai' ? 'AI' : '人工'}
            </span>
            <span className="pluse-kind-tag">{task.kind === 'recurring' ? '周期' : task.kind === 'scheduled' ? '定时' : '单次'}</span>
          </div>
        </div>
        <button type="button" className="pluse-icon-button" onClick={onClose} aria-label="关闭">
          <CloseIcon className="pluse-icon" />
        </button>
      </div>

      {/* Toast */}
      {toast && <div className="pluse-task-detail-toast">{toast}</div>}

      {/* Tabs */}
      <div className="pluse-tabs pluse-task-detail-tabs">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            className={`pluse-tab${tab === t ? ' is-active' : ''}`}
            onClick={() => setTab(t)}
          >
            {tabLabel[t]}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="pluse-task-detail-body">

        {/* Info tab */}
        {tab === 'info' && (
          <div className="pluse-task-detail-info">
            {task.waitingInstructions && (
              <div className="pluse-detail-field pluse-detail-field-highlight">
                <label>待办说明</label>
                <p>{task.waitingInstructions}</p>
              </div>
            )}
            {task.description && (
              <div className="pluse-detail-field">
                <label>描述</label>
                <p>{task.description}</p>
              </div>
            )}
            {blockedByTask && (
              <div className="pluse-detail-field">
                <label>等待任务</label>
                <p className="pluse-detail-field-blocked">{blockedByTask.title}</p>
              </div>
            )}
            {task.executor && (
              <div className="pluse-detail-field">
                <label>执行器</label>
                {task.executor.kind === 'ai_prompt' && (
                  <pre className="pluse-detail-pre">{task.executor.prompt}</pre>
                )}
                {task.executor.kind === 'script' && (
                  <pre className="pluse-detail-pre">{task.executor.command}</pre>
                )}
              </div>
            )}
            {task.scheduleConfig && (
              <div className="pluse-detail-field">
                <label>调度</label>
                <p>
                  {task.scheduleConfig.kind === 'recurring' && (
                    <>
                      {task.scheduleConfig.cron}
                      {task.scheduleConfig.nextRunAt && (
                        <span className="pluse-detail-field-sub"> · 下次 {formatTime(task.scheduleConfig.nextRunAt)}</span>
                      )}
                    </>
                  )}
                  {task.scheduleConfig.kind === 'scheduled' && formatTime(task.scheduleConfig.scheduledAt)}
                </p>
              </div>
            )}
            {task.completionOutput && (
              <div className="pluse-detail-field">
                <label>上次输出</label>
                <pre className="pluse-detail-pre">{task.completionOutput}</pre>
              </div>
            )}
            {!task.waitingInstructions && !task.description && !task.executor &&
              !task.scheduleConfig && !task.completionOutput && !blockedByTask && (
              <p className="pluse-detail-empty">暂无详细信息</p>
            )}
          </div>
        )}

        {/* History tab */}
        {tab === 'history' && (
          <div className="pluse-task-detail-history">
            {runs.length === 0 && logs.length === 0 && (
              <p className="pluse-detail-empty">暂无执行记录</p>
            )}
            {runs.map((run) => {
              const log = logs.find((l) => l.startedAt === run.startedAt)
              const isExpanded = expandedRunId === run.id
              return (
                <div key={run.id} className="pluse-run-entry">
                  <button
                    type="button"
                    className="pluse-run-entry-row"
                    onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                  >
                    <div className="pluse-run-entry-left">
                      {run.status === 'running' && (
                        <span className="pluse-run-dot is-running" />
                      )}
                      <span className={`pluse-run-status is-${run.status}`}>
                        {formatStatus(run.status)}
                      </span>
                      <span className="pluse-run-trigger">{run.triggeredBy}</span>
                    </div>
                    <div className="pluse-run-entry-right">
                      <span className="pluse-run-time">{formatTime(run.startedAt)}</span>
                      {run.completedAt && (
                        <span className="pluse-run-duration">
                          {Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)}s
                        </span>
                      )}
                    </div>
                  </button>
                  {run.error && <p className="pluse-run-error">{run.error}</p>}
                  {isExpanded && log?.output && (
                    <pre className="pluse-run-output">{log.output.slice(0, 2000)}{log.output.length > 2000 ? '\n…' : ''}</pre>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Ops tab */}
        {tab === 'ops' && (
          <div className="pluse-task-detail-ops">
            {ops.length === 0 && <p className="pluse-detail-empty">暂无操作记录</p>}
            {ops.map((op) => (
              <div key={op.id} className="pluse-op-entry">
                <span className="pluse-op-time">{formatTime(op.createdAt)}</span>
                <span className="pluse-op-actor">[{op.actor}]</span>
                <span className="pluse-op-label">{formatOp(op.op)}</span>
                {op.fromStatus && op.toStatus && (
                  <span className="pluse-op-transition">{op.fromStatus} → {op.toStatus}</span>
                )}
                {op.note && <span className="pluse-op-note">{op.note}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="pluse-task-detail-actions">
        <div className="pluse-task-detail-actions-left">
          {task.assignee === 'ai' && task.status !== 'done' && task.status !== 'cancelled' && (
            <button
              type="button"
              className={`pluse-toggle${task.enabled ? ' is-on' : ''}`}
              onClick={() => void handleToggleEnabled()}
              title={task.enabled ? '暂停调度' : '恢复调度'}
              aria-label={task.enabled ? '暂停' : '恢复'}
            />
          )}
          {confirmDelete ? (
            <div className="pluse-confirm-inline">
              <span>确认删除？</span>
              <button type="button" className="pluse-button pluse-button-danger pluse-button-xs" onClick={() => void handleDeleteConfirmed()}>删除</button>
              <button type="button" className="pluse-button pluse-button-xs" onClick={() => setConfirmDelete(false)}>取消</button>
            </div>
          ) : (
            <button
              type="button"
              className="pluse-delete-btn"
              onClick={() => setConfirmDelete(true)}
              title="删除任务"
            >
              ×
            </button>
          )}
        </div>

        <div className="pluse-task-detail-actions-right">
          {task.assignee === 'human' && task.status === 'pending' && (
            doneExpanded ? (
              <div className="pluse-done-inline">
                <input
                  autoFocus
                  type="text"
                  value={doneOutput}
                  onChange={(e) => setDoneOutput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleDone() }}
                  placeholder="备注（可选）"
                  className="pluse-done-input"
                />
                <button type="button" className="pluse-button pluse-button-success pluse-button-xs" onClick={() => void handleDone()}>
                  确认
                </button>
                <button type="button" className="pluse-button pluse-button-xs" onClick={() => { setDoneExpanded(false); setDoneOutput('') }}>
                  取消
                </button>
              </div>
            ) : (
              <button type="button" className="pluse-button pluse-button-success" onClick={() => setDoneExpanded(true)}>
                <CheckIcon className="pluse-icon" />
                完成
              </button>
            )
          )}

          {task.assignee === 'ai' && task.status === 'running' && (
            <span className="pluse-running-indicator">
              <span className="pluse-running-dot" />
              运行中
            </span>
          )}

          {task.assignee === 'ai' && (task.status === 'pending' || task.status === 'failed' || task.status === 'cancelled') && (
            <button type="button" className="pluse-button pluse-button-primary" onClick={() => void handleRun()}>
              <PlayIcon className="pluse-icon" />
              {task.status === 'failed' ? '重试' : '运行'}
            </button>
          )}
        </div>
      </div>

      {error && <p className="pluse-error">{error}</p>}
    </div>
  )
}
