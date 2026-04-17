import { useEffect, useState } from 'react'
import type { Task, TaskLog, TaskOp, TaskRun } from '@melody-sync/types'
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
    <div className="pulse-task-detail">
      {/* Header */}
      <div className="pulse-task-detail-header">
        <div className="pulse-task-detail-title">
          <h3>{task.title}</h3>
          <div className="pulse-task-detail-meta">
            <span className={`pulse-task-status is-${task.status}`}>{formatStatus(task.status)}</span>
            <span className="pulse-assignee-tag" data-assignee={task.assignee}>
              {task.assignee === 'ai' ? 'AI' : '人工'}
            </span>
            <span className="pulse-kind-tag">{task.kind === 'recurring' ? '周期' : task.kind === 'scheduled' ? '定时' : '单次'}</span>
          </div>
        </div>
        <button type="button" className="pulse-icon-button" onClick={onClose} aria-label="关闭">
          <CloseIcon className="pulse-icon" />
        </button>
      </div>

      {/* Toast */}
      {toast && <div className="pulse-task-detail-toast">{toast}</div>}

      {/* Tabs */}
      <div className="pulse-tabs pulse-task-detail-tabs">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            className={`pulse-tab${tab === t ? ' is-active' : ''}`}
            onClick={() => setTab(t)}
          >
            {tabLabel[t]}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="pulse-task-detail-body">

        {/* Info tab */}
        {tab === 'info' && (
          <div className="pulse-task-detail-info">
            {task.waitingInstructions && (
              <div className="pulse-detail-field pulse-detail-field-highlight">
                <label>待办说明</label>
                <p>{task.waitingInstructions}</p>
              </div>
            )}
            {task.description && (
              <div className="pulse-detail-field">
                <label>描述</label>
                <p>{task.description}</p>
              </div>
            )}
            {blockedByTask && (
              <div className="pulse-detail-field">
                <label>等待任务</label>
                <p className="pulse-detail-field-blocked">{blockedByTask.title}</p>
              </div>
            )}
            {task.executor && (
              <div className="pulse-detail-field">
                <label>执行器</label>
                {task.executor.kind === 'ai_prompt' && (
                  <pre className="pulse-detail-pre">{task.executor.prompt}</pre>
                )}
                {task.executor.kind === 'script' && (
                  <pre className="pulse-detail-pre">{task.executor.command}</pre>
                )}
              </div>
            )}
            {task.scheduleConfig && (
              <div className="pulse-detail-field">
                <label>调度</label>
                <p>
                  {task.scheduleConfig.kind === 'recurring' && (
                    <>
                      {task.scheduleConfig.cron}
                      {task.scheduleConfig.nextRunAt && (
                        <span className="pulse-detail-field-sub"> · 下次 {formatTime(task.scheduleConfig.nextRunAt)}</span>
                      )}
                    </>
                  )}
                  {task.scheduleConfig.kind === 'scheduled' && formatTime(task.scheduleConfig.scheduledAt)}
                </p>
              </div>
            )}
            {task.completionOutput && (
              <div className="pulse-detail-field">
                <label>上次输出</label>
                <pre className="pulse-detail-pre">{task.completionOutput}</pre>
              </div>
            )}
          </div>
        )}

        {/* History tab */}
        {tab === 'history' && (
          <div className="pulse-task-detail-history">
            {runs.length === 0 && logs.length === 0 && (
              <p className="pulse-detail-empty">暂无执行记录</p>
            )}
            {runs.map((run) => {
              const log = logs.find((l) => l.startedAt === run.startedAt)
              const isExpanded = expandedRunId === run.id
              return (
                <div key={run.id} className="pulse-run-entry">
                  <button
                    type="button"
                    className="pulse-run-entry-row"
                    onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                  >
                    <div className="pulse-run-entry-left">
                      {run.status === 'running' && (
                        <span className="pulse-run-dot is-running" />
                      )}
                      <span className={`pulse-run-status is-${run.status}`}>
                        {formatStatus(run.status)}
                      </span>
                      <span className="pulse-run-trigger">{run.triggeredBy}</span>
                    </div>
                    <div className="pulse-run-entry-right">
                      <span className="pulse-run-time">{formatTime(run.startedAt)}</span>
                      {run.completedAt && (
                        <span className="pulse-run-duration">
                          {Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)}s
                        </span>
                      )}
                    </div>
                  </button>
                  {run.error && <p className="pulse-run-error">{run.error}</p>}
                  {isExpanded && log?.output && (
                    <pre className="pulse-run-output">{log.output.slice(0, 2000)}{log.output.length > 2000 ? '\n…' : ''}</pre>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Ops tab */}
        {tab === 'ops' && (
          <div className="pulse-task-detail-ops">
            {ops.length === 0 && <p className="pulse-detail-empty">暂无操作记录</p>}
            {ops.map((op) => (
              <div key={op.id} className="pulse-op-entry">
                <span className="pulse-op-time">{formatTime(op.createdAt)}</span>
                <span className="pulse-op-actor">[{op.actor}]</span>
                <span className="pulse-op-label">{formatOp(op.op)}</span>
                {op.fromStatus && op.toStatus && (
                  <span className="pulse-op-transition">{op.fromStatus} → {op.toStatus}</span>
                )}
                {op.note && <span className="pulse-op-note">{op.note}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="pulse-task-detail-actions">
        <div className="pulse-task-detail-actions-left">
          {task.assignee === 'ai' && task.status !== 'done' && task.status !== 'cancelled' && (
            <button
              type="button"
              className={`pulse-toggle${task.enabled ? ' is-on' : ''}`}
              onClick={() => void handleToggleEnabled()}
              title={task.enabled ? '暂停调度' : '恢复调度'}
              aria-label={task.enabled ? '暂停' : '恢复'}
            />
          )}
          {confirmDelete ? (
            <div className="pulse-confirm-inline">
              <span>确认删除？</span>
              <button type="button" className="pulse-button pulse-button-danger pulse-button-xs" onClick={() => void handleDeleteConfirmed()}>删除</button>
              <button type="button" className="pulse-button pulse-button-xs" onClick={() => setConfirmDelete(false)}>取消</button>
            </div>
          ) : (
            <button
              type="button"
              className="pulse-delete-btn"
              onClick={() => setConfirmDelete(true)}
              title="删除任务"
            >
              ×
            </button>
          )}
        </div>

        <div className="pulse-task-detail-actions-right">
          {task.assignee === 'human' && task.status === 'pending' && (
            doneExpanded ? (
              <div className="pulse-done-inline">
                <input
                  autoFocus
                  type="text"
                  value={doneOutput}
                  onChange={(e) => setDoneOutput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleDone() }}
                  placeholder="备注（可选）"
                  className="pulse-done-input"
                />
                <button type="button" className="pulse-button pulse-button-success pulse-button-xs" onClick={() => void handleDone()}>
                  确认
                </button>
                <button type="button" className="pulse-button pulse-button-xs" onClick={() => { setDoneExpanded(false); setDoneOutput('') }}>
                  取消
                </button>
              </div>
            ) : (
              <button type="button" className="pulse-button pulse-button-success" onClick={() => setDoneExpanded(true)}>
                <CheckIcon className="pulse-icon" />
                完成
              </button>
            )
          )}

          {task.assignee === 'ai' && task.status === 'running' && (
            <span className="pulse-running-indicator">
              <span className="pulse-running-dot" />
              运行中
            </span>
          )}

          {task.assignee === 'ai' && (task.status === 'pending' || task.status === 'failed' || task.status === 'cancelled') && (
            <button type="button" className="pulse-button pulse-button-primary" onClick={() => void handleRun()}>
              <PlayIcon className="pulse-icon" />
              {task.status === 'failed' ? '重试' : '运行'}
            </button>
          )}
        </div>
      </div>

      {error && <p className="pulse-error">{error}</p>}
    </div>
  )
}
