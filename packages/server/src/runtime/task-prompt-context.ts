import type { ProjectActivityItem, Quest, Run, Todo } from '@pluse/types'
import { listEvents } from '../models/history'
import { listProjectActivity } from '../models/project-activity'
import { getProject } from '../models/project'
import { listQuests } from '../models/quest'
import { getRunsByProject } from '../models/run'
import { listTodos } from '../models/todo'

const MAX_SESSION_ITEMS = 6
const MAX_RUN_ITEMS = 8
const MAX_TODO_ITEMS = 6
const MAX_ACTIVITY_ITEMS = 8

function resolveTimeZone(quest: Quest): string {
  return quest.scheduleConfig?.timezone?.trim()
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'UTC'
}

function formatParts(value: string | number | Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(value))

  return Object.fromEntries(parts.map((part) => [part.type, part.value]))
}

function formatDateKey(value: string | number | Date, timeZone: string): string {
  const parts = formatParts(value, timeZone)
  return `${parts['year']}-${parts['month']}-${parts['day']}`
}

function formatDateCompact(value: string | number | Date, timeZone: string): string {
  return formatDateKey(value, timeZone).replace(/-/g, '_')
}

function formatTimeLabel(value: string | number | Date, timeZone: string): string {
  const parts = formatParts(value, timeZone)
  return `${parts['hour']}:${parts['minute']}`
}

function isOnDate(value: string | undefined, dateKey: string, timeZone: string): boolean {
  return Boolean(value) && formatDateKey(value!, timeZone) === dateKey
}

function sanitizeHumanText(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/`+/g, '')
    .replace(/\b(?:qst|run|todo|pact|req)_[a-z0-9]+\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncateText(value: string, limit = 120): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit - 1).trim()}…`
}

function firstMeaningfulLine(value?: string): string | null {
  if (!value?.trim()) return null
  const line = value
    .split('\n')
    .map((entry) => sanitizeHumanText(entry))
    .find((entry) => entry.length > 0)
  return line ? truncateText(line) : null
}

function displayQuestLabel(quest: Quest): string {
  return quest.kind === 'session'
    ? (quest.name?.trim() || quest.title?.trim() || quest.id)
    : (quest.title?.trim() || quest.name?.trim() || quest.id)
}

function summarizeSession(questId: string): string | null {
  const messages = listEvents(questId)
    .filter((event) => event.type === 'message' && event.content?.trim())

  const latestUser = [...messages].reverse().find((event) => event.role === 'user')
  const firstUser = messages.find((event) => event.role === 'user')
  const latestAssistant = [...messages].reverse().find((event) => event.role === 'assistant')
  const source = latestUser?.content ?? firstUser?.content ?? latestAssistant?.content
  return source ? truncateText(sanitizeHumanText(source)) : null
}

function summarizeTaskOutput(quest: Quest, run: Run): string | null {
  if (run.failureReason?.trim()) return firstMeaningfulLine(run.failureReason)
  return firstMeaningfulLine(quest.completionOutput) ?? firstMeaningfulLine(quest.description)
}

function describeRunState(state: Run['state']): string {
  if (state === 'completed') return '已完成'
  if (state === 'failed') return '失败'
  if (state === 'cancelled') return '已取消'
  if (state === 'running') return '运行中'
  if (state === 'accepted') return '已接收'
  return state
}

function describeTodoStatus(status: Todo['status']): string {
  if (status === 'pending') return '待处理'
  if (status === 'done') return '已完成'
  if (status === 'cancelled') return '已取消'
  return status
}

function describeActivityOp(item: ProjectActivityItem): string {
  if (item.op === 'created') return '已创建'
  if (item.op === 'kind_changed') return '切换形态'
  if (item.op === 'project_changed_in') return '移入项目'
  if (item.op === 'project_changed_out') return '移出项目'
  if (item.op === 'triggered') return '已触发'
  if (item.op === 'done') return '运行完成'
  if (item.op === 'failed') return '运行失败'
  if (item.op === 'cancelled') return '已取消'
  if (item.op === 'status_changed') return '状态变更'
  if (item.op === 'deleted') return '已归档'
  return item.op
}

function describeActivitySubject(subjectType: ProjectActivityItem['subjectType']): string {
  if (subjectType === 'session') return '会话'
  if (subjectType === 'task') return '任务'
  return '待办'
}

function buildSessionLines(quest: Quest, todayKey: string, timeZone: string): string[] {
  return listQuests({ projectId: quest.projectId, kind: 'session', deleted: false })
    .filter((item) => item.id !== quest.id && isOnDate(item.updatedAt, todayKey, timeZone))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, MAX_SESSION_ITEMS)
    .map((item) => {
      const summary = summarizeSession(item.id)
      const suffix = summary ? `：${summary}` : ''
      return `- ${displayQuestLabel(item)}（${formatTimeLabel(item.updatedAt, timeZone)}）${suffix}`
    })
}

function buildRunLines(quest: Quest, todayKey: string, timeZone: string): string[] {
  const questMap = new Map(
    listQuests({ projectId: quest.projectId, deleted: false }).map((item) => [item.id, item]),
  )

  return getRunsByProject(quest.projectId, 60)
    .filter((run) => {
      if (run.questId === quest.id) return false
      const targetQuest = questMap.get(run.questId)
      if (!targetQuest || targetQuest.kind !== 'task') return false
      const time = run.completedAt ?? run.finalizedAt ?? run.startedAt ?? run.createdAt
      return isOnDate(time, todayKey, timeZone)
    })
    .slice(0, MAX_RUN_ITEMS)
    .map((run) => {
      const targetQuest = questMap.get(run.questId)!
      const time = run.completedAt ?? run.finalizedAt ?? run.startedAt ?? run.createdAt
      const summary = summarizeTaskOutput(targetQuest, run)
      const suffix = summary ? `：${summary}` : ''
      return `- ${displayQuestLabel(targetQuest)}（${formatTimeLabel(time, timeZone)}，${describeRunState(run.state)}）${suffix}`
    })
}

function buildTodoLines(quest: Quest): string[] {
  return listTodos({ projectId: quest.projectId, deleted: false })
    .filter((item) => item.status === 'pending' && item.originQuestId !== quest.id)
    .slice(0, MAX_TODO_ITEMS)
    .map((item) => {
      const detail = firstMeaningfulLine(item.waitingInstructions) ?? firstMeaningfulLine(item.description)
      const suffix = detail ? `：${detail}` : ''
      return `- ${item.title}（${describeTodoStatus(item.status)}）${suffix}`
    })
}

function buildActivityLines(quest: Quest, todayKey: string, timeZone: string): string[] {
  return listProjectActivity(quest.projectId, 60)
    .filter((item) => item.questId !== quest.id && isOnDate(item.createdAt, todayKey, timeZone))
    .slice(0, MAX_ACTIVITY_ITEMS)
    .map((item) => {
      const note = firstMeaningfulLine(item.note)
      const suffix = note ? `：${note}` : ''
      return `- ${formatTimeLabel(item.createdAt, timeZone)} ${describeActivitySubject(item.subjectType)}「${item.title}」${describeActivityOp(item)}${suffix}`
    })
}

function renderSection(title: string, lines: string[]): string {
  return [title, ...(lines.length > 0 ? lines : ['- 无'])].join('\n')
}

function buildProjectSnapshot(quest: Quest, todayKey: string, timeZone: string): string {
  const project = getProject(quest.projectId)
  const sessionLines = buildSessionLines(quest, todayKey, timeZone)
  const runLines = buildRunLines(quest, todayKey, timeZone)
  const todoLines = buildTodoLines(quest)
  const activityLines = buildActivityLines(quest, todayKey, timeZone)

  return [
    `项目今日快照：${project?.name ?? quest.projectId}`,
    `统计日期：${todayKey} (${timeZone})`,
    '默认只把下面这些事实当作依据来总结，优先写人实际做了什么，不要把内部 ID 当正文。',
    '',
    renderSection('今日会话：', sessionLines),
    '',
    renderSection('今日任务运行：', runLines),
    '',
    renderSection('当前待办：', todoLines),
    '',
    renderSection('今日项目活动：', activityLines),
  ].join('\n')
}

export function buildTaskPromptContext(quest: Quest): Record<string, string> {
  const now = new Date()
  const timeZone = resolveTimeZone(quest)
  const todayDate = formatDateKey(now, timeZone)
  return {
    date: todayDate,
    datetime: now.toISOString(),
    timeZone,
    todayDate,
    todayDateCompact: formatDateCompact(now, timeZone),
    projectSnapshot: buildProjectSnapshot(quest, todayDate, timeZone),
    todayProjectSnapshot: buildProjectSnapshot(quest, todayDate, timeZone),
  }
}
