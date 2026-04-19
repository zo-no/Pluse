import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate, type Location as RouterLocation } from 'react-router-dom'
import type { Quest, QuestOp, Run, RuntimeModelCatalog, RuntimeTool } from '@pluse/types'
import * as api from '@/api/client'
import { useI18n } from '@/i18n'
import { displaySessionName, displayTaskName } from '@/views/utils/display'
import { buildFallbackRuntimeModelCatalog, defaultRuntimeEffortId, defaultRuntimeModelId, resolveRuntimeEffortSelection, resolveRuntimeModelSelection } from '@/views/utils/runtime'
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '@/views/utils/todo'
import { parseSseMessage } from '@/views/utils/sse'
import { ArchiveIcon, CloseIcon, ConvertIcon, PlayIcon, PlusIcon } from './icons'
import { TaskComposerModal } from './TaskComposerModal'

interface TaskDetailProps {
  questId: string
  onQuestLoaded?: (quest: Quest) => void
  onDataChanged?: () => Promise<void> | void
}

function formatDateTime(value?: string, locale = 'zh-CN', t?: (key: string) => string): string {
  if (!value) return t ? t('未记录') : '未记录'
  return new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatStatus(status?: string, t?: (key: string) => string): string {
  if (!status) return t ? t('未设置') : '未设置'
  if (status === 'pending') return t ? t('待处理') : '待处理'
  if (status === 'running') return t ? t('运行中') : '运行中'
  if (status === 'done' || status === 'completed') return t ? t('已完成') : '已完成'
  if (status === 'failed') return t ? t('失败') : '失败'
  if (status === 'cancelled') return t ? t('已取消') : '已取消'
  if (status === 'idle') return t ? t('空闲') : '空闲'
  return status
}

function formatTrigger(trigger: Run['trigger'], t?: (key: string) => string): string {
  if (trigger === 'chat') return t ? t('会话') : '会话'
  if (trigger === 'manual') return t ? t('手动') : '手动'
  return t ? t('自动') : '自动'
}

function formatScheduleKind(value?: Quest['scheduleKind'], t?: (key: string) => string): string {
  if (value === 'scheduled') return t ? t('定时') : '定时'
  if (value === 'recurring') return t ? t('周期') : '周期'
  return t ? t('手动') : '手动'
}

function formatOp(op: QuestOp['op'], t?: (key: string) => string): string {
  if (op === 'created') return t ? t('已创建') : '已创建'
  if (op === 'kind_changed') return t ? t('形态切换') : '形态切换'
  if (op === 'triggered') return t ? t('已触发') : '已触发'
  if (op === 'done') return t ? t('已完成') : '已完成'
  if (op === 'failed') return t ? t('失败') : '失败'
  if (op === 'cancelled') return t ? t('已取消') : '已取消'
  if (op === 'status_changed') return t ? t('状态变更') : '状态变更'
  if (op === 'deleted') return t ? t('已归档') : '已归档'
  return op
}

function envToText(value: Record<string, string> | undefined): string {
  if (!value) return ''
  return Object.entries(value)
    .map(([key, item]) => `${key}=${item}`)
    .join('\n')
}

function defaultTaskTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function parseEnvText(value: string): Record<string, string> | undefined {
  const entries = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf('=')
      if (index === -1) return null
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()] as const
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry && entry[0]))

  if (!entries.length) return undefined
  return Object.fromEntries(entries)
}

type SegmentedOption<T extends string> = {
  value: T
  label: string
}

type TaskRecurringPreset = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom'

type ParsedRecurringSchedule = {
  preset: TaskRecurringPreset
  time: string
  weekday: string
  monthDay: string
  customCron: string
}

type TranslateFn = (key: string, values?: Record<string, string | number>) => string

type TaskDetailFormState = {
  title: string
  description: string
  tool: string
  model: string
  effort: string
  thinking: boolean
  reviewOnComplete: boolean
  executorKind: 'ai_prompt' | 'script'
  prompt: string
  command: string
  workDir: string
  envText: string
  timeout: string
  continueQuest: boolean
  scheduleKind: 'once' | 'scheduled' | 'recurring'
  runAt: string
  recurringPreset: TaskRecurringPreset
  recurringTime: string
  recurringWeekday: string
  recurringMonthDay: string
  cron: string
}

function padNumber(value: number): string {
  return String(value).padStart(2, '0')
}

function formatEffortLabel(value: string, t: TranslateFn): string {
  if (value === 'low') return t('低')
  if (value === 'medium') return t('标准')
  if (value === 'high') return t('高')
  if (value === 'xhigh') return t('超高')
  return value
}

function formatLocalTime(hour: number, minute: number): string {
  return `${padNumber(hour)}:${padNumber(minute)}`
}

function parseTimeInput(value: string): { hour: number; minute: number } {
  const match = value.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return { hour: 9, minute: 0 }
  const hour = Math.min(23, Math.max(0, Number.parseInt(match[1] ?? '9', 10)))
  const minute = Math.min(59, Math.max(0, Number.parseInt(match[2] ?? '0', 10)))
  return { hour, minute }
}

function normalizeCronWeekdayToken(value: string): string {
  return value === '7' ? '0' : value
}

function nextWeekdayAt(base: Date, weekday: number, hour: number, minute: number): Date {
  const next = new Date(base)
  next.setHours(hour, minute, 0, 0)
  let offset = (weekday - next.getDay() + 7) % 7
  if (offset === 0 && next.getTime() <= base.getTime()) offset = 7
  next.setDate(next.getDate() + offset)
  return next
}

function parseRecurringCron(cron?: string): ParsedRecurringSchedule {
  const fallback: ParsedRecurringSchedule = {
    preset: 'daily',
    time: '09:00',
    weekday: '1',
    monthDay: String(new Date().getDate()),
    customCron: cron?.trim() ?? '',
  }
  if (!cron?.trim()) return fallback

  const normalized = cron.trim().replace(/\s+/g, ' ')
  const weekdaysMatch = normalized.match(/^(\d{1,2}) (\d{1,2}) \* \* 1-5$/)
  if (weekdaysMatch) {
    return {
      ...fallback,
      preset: 'weekdays',
      time: formatLocalTime(Number.parseInt(weekdaysMatch[2] ?? '9', 10), Number.parseInt(weekdaysMatch[1] ?? '0', 10)),
      customCron: normalized,
    }
  }

  const weeklyMatch = normalized.match(/^(\d{1,2}) (\d{1,2}) \* \* ([0-7])$/)
  if (weeklyMatch) {
    return {
      ...fallback,
      preset: 'weekly',
      time: formatLocalTime(Number.parseInt(weeklyMatch[2] ?? '9', 10), Number.parseInt(weeklyMatch[1] ?? '0', 10)),
      weekday: normalizeCronWeekdayToken(weeklyMatch[3] ?? '1'),
      customCron: normalized,
    }
  }

  const monthlyMatch = normalized.match(/^(\d{1,2}) (\d{1,2}) ([1-9]|[12]\d|3[01]) \* \*$/)
  if (monthlyMatch) {
    return {
      ...fallback,
      preset: 'monthly',
      time: formatLocalTime(Number.parseInt(monthlyMatch[2] ?? '9', 10), Number.parseInt(monthlyMatch[1] ?? '0', 10)),
      monthDay: monthlyMatch[3] ?? fallback.monthDay,
      customCron: normalized,
    }
  }

  const dailyMatch = normalized.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/)
  if (dailyMatch) {
    return {
      ...fallback,
      preset: 'daily',
      time: formatLocalTime(Number.parseInt(dailyMatch[2] ?? '9', 10), Number.parseInt(dailyMatch[1] ?? '0', 10)),
      customCron: normalized,
    }
  }

  return {
    ...fallback,
    preset: 'custom',
    customCron: normalized,
  }
}

function buildRecurringCron(input: ParsedRecurringSchedule): string | null {
  if (input.preset === 'custom') return input.customCron.trim() || null

  const { hour, minute } = parseTimeInput(input.time)
  const cronPrefix = `${minute} ${hour}`
  if (input.preset === 'daily') return `${cronPrefix} * * *`
  if (input.preset === 'weekdays') return `${cronPrefix} * * 1-5`
  if (input.preset === 'weekly') return `${cronPrefix} * * ${normalizeCronWeekdayToken(input.weekday || '1')}`
  const monthDay = Math.min(31, Math.max(1, Number.parseInt(input.monthDay || '1', 10) || 1))
  return `${cronPrefix} ${monthDay} * *`
}

function formatRecurringSummary(input: ParsedRecurringSchedule, t: TranslateFn): string {
  const weekdayLabel = input.weekday === '1' ? t('每周一')
    : input.weekday === '2' ? t('每周二')
      : input.weekday === '3' ? t('每周三')
        : input.weekday === '4' ? t('每周四')
          : input.weekday === '5' ? t('每周五')
            : input.weekday === '6' ? t('每周六')
              : t('每周日')

  if (input.preset === 'daily') return t('每天 {{time}}', { time: input.time })
  if (input.preset === 'weekdays') return t('工作日 {{time}}', { time: input.time })
  if (input.preset === 'weekly') return t('{{day}} {{time}}', { day: weekdayLabel, time: input.time })
  if (input.preset === 'monthly') return t('每月 {{day}} 日 {{time}}', { day: input.monthDay || '1', time: input.time })
  return input.customCron.trim() ? t('自定义 Cron · {{cron}}', { cron: input.customCron.trim() }) : t('自定义周期')
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: Array<SegmentedOption<T>>
  onChange: (value: T) => void
  ariaLabel: string
}) {
  return (
    <div className="pluse-task-segmented" role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={`pluse-task-segmented-option${value === option.value ? ' is-active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function TaskSettingSwitch({
  label,
  note,
  checked,
  onChange,
}: {
  label: string
  note: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button type="button" className={`pluse-task-setting-switch${checked ? ' is-on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="pluse-task-setting-switch-copy">
        <strong>{label}</strong>
        <span>{note}</span>
      </span>
      <span className={`pluse-toggle${checked ? ' is-on' : ''}`} aria-hidden="true" />
    </button>
  )
}

interface TaskDetailLocationState {
  backgroundLocation?: RouterLocation
  nextQuestId?: string
}

function resolveCloseTarget(location: RouterLocation, fallback: string): string {
  const state = location.state as TaskDetailLocationState | null
  if (state?.nextQuestId) return `/quests/${state.nextQuestId}`
  const background = state?.backgroundLocation
  return background ? `${background.pathname}${background.search}${background.hash}` : fallback
}

export function TaskDetail({ questId, onQuestLoaded, onDataChanged }: TaskDetailProps) {
  const { locale, t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const [quest, setQuest] = useState<Quest | null>(null)
  const [runs, setRuns] = useState<Run[]>([])
  const [ops, setOps] = useState<QuestOp[]>([])
  const [tools, setTools] = useState<RuntimeTool[]>([])
  const [catalog, setCatalog] = useState<RuntimeModelCatalog | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createTaskModalOpen, setCreateTaskModalOpen] = useState(false)
  const [form, setForm] = useState<TaskDetailFormState>({
    title: '',
    description: '',
    tool: 'codex',
    model: '',
    effort: '',
    thinking: false,
    reviewOnComplete: false,
    executorKind: 'ai_prompt' as 'ai_prompt' | 'script',
    prompt: '',
    command: '',
    workDir: '',
    envText: '',
    timeout: '',
    continueQuest: true,
    scheduleKind: 'once' as 'once' | 'scheduled' | 'recurring',
    runAt: '',
    recurringPreset: 'daily',
    recurringTime: '09:00',
    recurringWeekday: '1',
    recurringMonthDay: String(new Date().getDate()),
    cron: '',
  })
  const reloadTimer = useRef<number | null>(null)

  async function loadData() {
    const [questResult, runsResult, opsResult] = await Promise.all([
      api.getQuest(questId),
      api.getQuestRuns(questId),
      api.getQuestOps(questId),
    ])
    if (!questResult.ok) {
      setError(questResult.error)
      return
    }

    const nextQuest = questResult.data
    const executorConfig = nextQuest.executorConfig
    const recurringSchedule = parseRecurringCron(nextQuest.scheduleConfig?.cron)
    const timeoutValue = nextQuest.executorKind === 'script'
      ? executorConfig && 'timeout' in executorConfig ? executorConfig.timeout : undefined
      : nextQuest.executorOptions?.timeout

    setQuest(nextQuest)
    onQuestLoaded?.(nextQuest)
    setRuns(runsResult.ok ? runsResult.data : [])
    setOps(opsResult.ok ? opsResult.data : [])
    setForm({
      title: displayTaskName(nextQuest.title ?? nextQuest.name, t),
      description: nextQuest.description ?? '',
      tool: nextQuest.tool ?? 'codex',
      model: resolveRuntimeModelSelection(nextQuest.tool, nextQuest.model),
      effort: resolveRuntimeEffortSelection(nextQuest.tool, nextQuest.effort),
      thinking: nextQuest.thinking ?? false,
      reviewOnComplete: nextQuest.reviewOnComplete === true,
      executorKind: nextQuest.executorKind === 'script' ? 'script' : 'ai_prompt',
      prompt: nextQuest.executorKind === 'ai_prompt' && executorConfig && 'prompt' in executorConfig ? executorConfig.prompt : '',
      command: nextQuest.executorKind === 'script' && executorConfig && 'command' in executorConfig ? executorConfig.command : '',
      workDir: nextQuest.executorKind === 'script' && executorConfig && 'workDir' in executorConfig ? executorConfig.workDir ?? '' : '',
      envText: nextQuest.executorKind === 'script' && executorConfig && 'env' in executorConfig ? envToText(executorConfig.env) : '',
      timeout: timeoutValue === undefined ? '' : String(timeoutValue),
      continueQuest: nextQuest.executorOptions?.continueQuest !== false,
      scheduleKind: nextQuest.scheduleKind ?? 'once',
      runAt: toDateTimeLocalValue(nextQuest.scheduleConfig?.runAt),
      recurringPreset: recurringSchedule.preset,
      recurringTime: recurringSchedule.time,
      recurringWeekday: recurringSchedule.weekday,
      recurringMonthDay: recurringSchedule.monthDay,
      cron: recurringSchedule.customCron,
    })
    setError(null)
  }

  useEffect(() => {
    void loadData()
  }, [questId])

  useEffect(() => {
    void api.getRuntimeTools().then((result) => {
      if (result.ok) setTools(result.data)
    })
  }, [])

  useEffect(() => {
    void api.getRuntimeModelCatalog(form.tool).then((result) => {
      if (result.ok && result.data.models.length > 0) setCatalog(result.data)
      else setCatalog(buildFallbackRuntimeModelCatalog(form.tool))
    })
  }, [form.tool])

  useEffect(() => {
    const source = new EventSource(`/api/events?questId=${encodeURIComponent(questId)}`)
    let pendingReload = false
    let pendingProjectRefresh = false

    source.onmessage = (message) => {
      const event = parseSseMessage(message.data)
      if (!event) return
      if (event.type === 'quest_updated') {
        pendingReload = true
        pendingProjectRefresh = true
      }
      if (event.type === 'run_updated') {
        pendingReload = true
      }
      if (!pendingReload) return

      if (reloadTimer.current) window.clearTimeout(reloadTimer.current)
      reloadTimer.current = window.setTimeout(() => {
        const shouldRefreshProject = pendingProjectRefresh

        pendingReload = false
        pendingProjectRefresh = false

        void loadData()
        if (shouldRefreshProject) void onDataChanged?.()
      }, 200)
    }
    return () => {
      source.close()
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current)
    }
  }, [questId, onDataChanged])

  const effortOptions = useMemo(() => catalog?.effortLevels ?? [], [catalog])
  const toolOptions = useMemo<Array<SegmentedOption<string>>>(
    () => {
      const source = tools.length > 0
        ? tools
        : [
            { id: 'codex', name: 'Codex' },
            { id: 'claude', name: 'Claude' },
          ]
      return source.map((tool) => ({ value: tool.id, label: tool.name }))
    },
    [tools],
  )
  const effortChoiceOptions = useMemo<Array<SegmentedOption<string>>>(
    () => effortOptions.map((item) => ({ value: item, label: formatEffortLabel(item, t) })),
    [effortOptions, t],
  )
  const executorKindOptions = useMemo<Array<SegmentedOption<'ai_prompt' | 'script'>>>(
    () => [
      { value: 'ai_prompt', label: t('AI 提示词') },
      { value: 'script', label: t('脚本') },
    ],
    [t],
  )
  const scheduleKindOptions = useMemo<Array<SegmentedOption<'once' | 'scheduled' | 'recurring'>>>(
    () => [
      { value: 'once', label: t('手动') },
      { value: 'scheduled', label: t('定时') },
      { value: 'recurring', label: t('周期') },
    ],
    [t],
  )
  const recurringPresetOptions = useMemo<Array<SegmentedOption<TaskRecurringPreset>>>(
    () => [
      { value: 'daily', label: t('每天') },
      { value: 'weekdays', label: t('工作日') },
      { value: 'weekly', label: t('每周') },
      { value: 'monthly', label: t('每月') },
      { value: 'custom', label: t('自定义') },
    ],
    [t],
  )
  const recurringWeekdayOptions = useMemo<Array<SegmentedOption<string>>>(
    () => [
      { value: '1', label: t('周一') },
      { value: '2', label: t('周二') },
      { value: '3', label: t('周三') },
      { value: '4', label: t('周四') },
      { value: '5', label: t('周五') },
      { value: '6', label: t('周六') },
      { value: '0', label: t('周日') },
    ],
    [t],
  )
  const toolLabel = useMemo(
    () => tools.find((tool) => tool.id === form.tool)?.name ?? form.tool,
    [form.tool, tools],
  )
  const resolvedModelId = useMemo(() => resolveRuntimeModelSelection(form.tool, form.model, catalog), [catalog, form.model, form.tool])
  const selectedModelLabel = useMemo(
    () => catalog?.models.find((model) => model.id === resolvedModelId)?.label ?? resolvedModelId,
    [catalog, resolvedModelId],
  )
  const scheduledQuickOptions = useMemo(() => {
    const now = new Date()
    const tonight = new Date(now)
    tonight.setHours(18, 0, 0, 0)
    const tonightLabel = tonight.getTime() > now.getTime() ? t('今晚 18:00') : t('明晚 18:00')
    if (tonight.getTime() <= now.getTime()) tonight.setDate(tonight.getDate() + 1)

    const tomorrowMorning = new Date(now)
    tomorrowMorning.setDate(now.getDate() + 1)
    tomorrowMorning.setHours(9, 0, 0, 0)

    const tomorrowAfternoon = new Date(now)
    tomorrowAfternoon.setDate(now.getDate() + 1)
    tomorrowAfternoon.setHours(15, 0, 0, 0)

    const nextMondayMorning = nextWeekdayAt(now, 1, 9, 0)

    return [
      { id: 'tonight', label: tonightLabel, value: toDateTimeLocalValue(tonight.toISOString()) },
      { id: 'tomorrow-morning', label: t('明早 09:00'), value: toDateTimeLocalValue(tomorrowMorning.toISOString()) },
      { id: 'tomorrow-afternoon', label: t('明天下午 15:00'), value: toDateTimeLocalValue(tomorrowAfternoon.toISOString()) },
      { id: 'next-monday', label: t('下周一 09:00'), value: toDateTimeLocalValue(nextMondayMorning.toISOString()) },
    ]
  }, [t])
  const recurringSummary = useMemo(
    () => formatRecurringSummary({
      preset: form.recurringPreset,
      time: form.recurringTime,
      weekday: form.recurringWeekday,
      monthDay: form.recurringMonthDay,
      customCron: form.cron,
    }, t),
    [form.recurringMonthDay, form.recurringPreset, form.recurringTime, form.recurringWeekday, form.cron, t],
  )
  const scheduledSummary = useMemo(() => {
    const iso = fromDateTimeLocalValue(form.runAt)
    return iso ? formatDateTime(iso, locale, t) : t('尚未设置时间')
  }, [form.runAt, locale, t])
  const closeTarget = resolveCloseTarget(location, quest ? `/projects/${quest.projectId}` : '/')
  function closeModal() {
    navigate(closeTarget, { replace: true })
  }

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !createTaskModalOpen) {
        closeModal()
      }
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [createTaskModalOpen, closeTarget])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!quest) return
    if (quest.activeRunId && quest.enabled === false) {
      const confirmed = window.confirm(t('当前任务正在运行，停用前会先取消当前执行。继续吗？'))
      if (!confirmed) return
      const cancelled = await api.cancelRun(quest.activeRunId)
      if (!cancelled.ok) {
        setError(cancelled.error)
        return
      }
      let cleared = false
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const current = await api.getQuest(quest.id)
        if (current.ok && !current.data.activeRunId) {
          cleared = true
          break
        }
        await new Promise((resolve) => window.setTimeout(resolve, 150))
      }
      if (!cleared) {
        setError(t('当前执行尚未完全停止，请稍后再试'))
        return
      }
    }
    setSaving(true)
    const parsedTimeout = Number(form.timeout)
    const timeoutValue = form.timeout.trim() && Number.isFinite(parsedTimeout) ? parsedTimeout : undefined
    const env = parseEnvText(form.envText)
    const scheduledRunAt = form.scheduleKind === 'scheduled' ? fromDateTimeLocalValue(form.runAt) : undefined
    const recurringCron = form.scheduleKind === 'recurring'
      ? buildRecurringCron({
          preset: form.recurringPreset,
          time: form.recurringTime,
          weekday: form.recurringWeekday,
          monthDay: form.recurringMonthDay,
          customCron: form.cron,
        })
      : null

    if (form.scheduleKind === 'scheduled' && !scheduledRunAt) {
      setSaving(false)
      setError(t('请选择运行时间'))
      return
    }

    if (form.scheduleKind === 'recurring' && !recurringCron) {
      setSaving(false)
      setError(form.recurringPreset === 'custom' ? t('请输入 Cron 表达式') : t('请完善周期设置'))
      return
    }

    const result = await api.updateQuest(quest.id, {
      kind: 'task',
      title: form.title.trim() || t('未命名任务'),
      description: form.description.trim() || null,
      tool: form.tool,
      model: form.model || null,
      effort: form.effort || null,
      thinking: form.thinking,
      enabled: quest.enabled !== false,
      reviewOnComplete: form.reviewOnComplete,
      executorKind: form.executorKind,
      executorConfig: form.executorKind === 'script'
        ? {
            command: form.command.trim(),
            workDir: form.workDir.trim() || undefined,
            env,
            timeout: timeoutValue,
          }
        : {
            prompt: form.prompt,
            agent: form.tool === 'claude' ? 'claude' : 'codex',
            model: form.model || undefined,
          },
      executorOptions: {
        continueQuest: form.continueQuest,
        timeout: form.executorKind === 'ai_prompt' ? timeoutValue : undefined,
      },
      scheduleKind: form.scheduleKind,
      scheduleConfig: form.scheduleKind === 'scheduled'
        ? { runAt: scheduledRunAt, timezone: defaultTaskTimezone() }
        : form.scheduleKind === 'recurring'
          ? { cron: recurringCron ?? undefined, timezone: defaultTaskTimezone() }
          : null,
      status: quest.status === 'idle' ? 'pending' : quest.status,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setQuest(result.data)
    onQuestLoaded?.(result.data)
    await onDataChanged?.()
  }

  async function handleRunNow() {
    if (!quest) return
    const result = await api.startQuestRun(quest.id, { trigger: 'manual', triggeredBy: 'human' })
    if (!result.ok) {
      setError(result.error)
      return
    }
    await loadData()
    await onDataChanged?.()
  }

  async function handleCancelRun() {
    if (!quest?.activeRunId) return
    const result = await api.cancelRun(quest.activeRunId)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await loadData()
  }

  async function handleArchiveTask() {
    if (!quest) return
    const archived = quest.deleted === true
    if (!archived && quest.activeRunId) {
      const confirmed = window.confirm(t('当前任务正在运行，归档前会先取消当前执行。继续吗？'))
      if (!confirmed) return
      const cancelled = await api.cancelRun(quest.activeRunId)
      if (!cancelled.ok) {
        setError(cancelled.error)
        return
      }
      let cleared = false
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const current = await api.getQuest(quest.id)
        if (current.ok && !current.data.activeRunId) {
          cleared = true
          break
        }
        await new Promise((resolve) => window.setTimeout(resolve, 150))
      }
      if (!cleared) {
        setError(t('当前执行尚未完全停止，请稍后再试'))
        return
      }
    }
    const result = await api.updateQuest(quest.id, { deleted: !archived })
    if (!result.ok) {
      setError(result.error)
      return
    }
    await onDataChanged?.()
    if (!archived) {
      const questsResult = await api.getQuests({ projectId: quest.projectId, deleted: false })
      const state = location.state as TaskDetailLocationState | null
      const fallback = state?.nextQuestId
        ? `/quests/${state.nextQuestId}`
        : questsResult.ok
          ? (() => {
            const quests = questsResult.data
            const index = quests.findIndex((item) => item.id === quest.id)
            const nextQuest = index >= 0 ? quests[index + 1] || quests[index - 1] : null
            return nextQuest ? `/quests/${nextQuest.id}` : `/projects/${quest.projectId}`
          })()
          : `/projects/${quest.projectId}`
      navigate(fallback, { replace: true })
    } else {
      setQuest(result.data)
      onQuestLoaded?.(result.data)
    }
  }

  async function handleSwitchToSession() {
    if (!quest) return
    const result = await api.updateQuest(quest.id, {
      kind: 'session',
      name: displaySessionName(quest.title ?? quest.name, t),
    })
    if (!result.ok) {
      setError(result.error)
      return
    }
    onQuestLoaded?.(result.data)
    await onDataChanged?.()
    navigate(`/quests/${result.data.id}`, { replace: true })
  }

  return (
    <>
      <div
        className="pluse-modal-backdrop pluse-task-detail-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving && !createTaskModalOpen) closeModal()
        }}
      >
        <section
          className="pluse-modal-panel pluse-task-detail-modal"
          role="dialog"
          aria-modal="true"
          aria-label={quest ? t('任务 {{name}}', { name: displayTaskName(quest.title ?? quest.name, t) }) : t('任务详情')}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="pluse-task-detail-head">
            <div className="pluse-task-detail-identity">
              <span className="pluse-task-detail-kicker">{t('AI 任务')}</span>
              <div className="pluse-task-detail-title-row">
                <h2>{quest ? (form.title || t('未命名任务')) : t('正在加载任务…')}</h2>
                {quest ? <span className={`pluse-task-status is-${quest.status ?? 'idle'}`}>{formatStatus(quest.status, t)}</span> : null}
                {quest?.activeRunId ? <span className="pluse-inline-pill is-running">{t('运行中')}</span> : null}
              </div>
              {quest ? (
                <div className="pluse-task-detail-meta">
                  <span>{toolLabel}</span>
                  <span>{selectedModelLabel}</span>
                  <span>{formatScheduleKind(form.scheduleKind, t)}</span>
                  <span>{form.continueQuest ? t('继续上下文') : t('独立运行')}</span>
                  {quest.enabled === false ? <span>{t('已暂停')}</span> : null}
                  {quest.deleted ? <span>{t('已归档')}</span> : null}
                </div>
              ) : null}
            </div>
            <button type="button" className="pluse-icon-button" onClick={closeModal} aria-label={t('关闭任务详情')} title={t('关闭任务详情')}>
              <CloseIcon className="pluse-icon" />
            </button>
          </header>

          {!quest ? (
            <div className="pluse-task-detail-loading">
              <p className="pluse-empty-inline">{error ? t('加载失败：{error}', { error }) : t('正在加载任务…')}</p>
            </div>
          ) : (
            <form className="pluse-task-detail-form" onSubmit={save}>
              <div className="pluse-task-detail-toolbar">
                <div className="pluse-task-detail-toolbar-group">
                  <button type="submit" className="pluse-button" disabled={saving}>
                    {saving ? t('保存中…') : t('保存')}
                  </button>
                  <button
                    type="button"
                    className="pluse-button pluse-button-ghost"
                    onClick={() => void handleRunNow()}
                    disabled={Boolean(quest.activeRunId) || quest.enabled === false || quest.deleted}
                  >
                    <PlayIcon className="pluse-icon" />
                    {t('立即运行')}
                  </button>
                  {quest.activeRunId ? (
                    <button type="button" className="pluse-button pluse-button-danger" onClick={() => void handleCancelRun()}>
                      {t('停止')}
                    </button>
                  ) : null}
                </div>
                <div className="pluse-task-detail-toolbar-group">
                  <button
                    type="button"
                    className="pluse-icon-button"
                    title={t('新建人类任务')}
                    aria-label={t('新建人类任务')}
                    onClick={() => setCreateTaskModalOpen(true)}
                  >
                    <PlusIcon className="pluse-icon" />
                  </button>
                  <button
                    type="button"
                    className="pluse-icon-button"
                    title={t('转会话')}
                    aria-label={t('转会话')}
                    onClick={() => void handleSwitchToSession()}
                    disabled={Boolean(quest.activeRunId) || quest.deleted}
                  >
                    <ConvertIcon className="pluse-icon" />
                  </button>
                  <button
                    type="button"
                    className="pluse-icon-button"
                    title={quest.deleted ? t('恢复任务') : t('归档任务')}
                    aria-label={quest.deleted ? t('恢复任务') : t('归档任务')}
                    onClick={() => void handleArchiveTask()}
                  >
                    {quest.deleted ? <PlusIcon className="pluse-icon" /> : <ArchiveIcon className="pluse-icon" />}
                  </button>
                </div>
              </div>

              <div className="pluse-task-detail-body">
                <section className="pluse-task-detail-section">
                  <header className="pluse-task-detail-section-head">
                    <div>
                      <h3>{t('基础')}</h3>
                    </div>
                  </header>
                  <div className="pluse-form-grid pluse-task-detail-config-grid">
                    <label className="pluse-task-detail-field pluse-form-span">
                      <span>{t('标题')}</span>
                      <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
                    </label>
                    <label className="pluse-task-detail-field pluse-form-span">
                      <span>{t('说明')}</span>
                      <textarea
                        rows={3}
                        value={form.description}
                        onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                      />
                    </label>
                    <div className="pluse-task-detail-field pluse-form-span">
                      <span>{t('工具')}</span>
                      <SegmentedControl
                        value={form.tool}
                        options={toolOptions}
                        ariaLabel={t('工具')}
                        onChange={(tool) => {
                          setCatalog(buildFallbackRuntimeModelCatalog(tool))
                          setForm((current) => ({
                            ...current,
                            tool,
                            model: defaultRuntimeModelId(tool),
                            effort: defaultRuntimeEffortId(tool),
                          }))
                        }}
                      />
                    </div>
                    <label className="pluse-task-detail-field">
                      <span>{t('模型')}</span>
                      <select value={resolvedModelId} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}>
                        {catalog?.models.map((model) => (
                          <option key={model.id} value={model.id}>{model.label}</option>
                        ))}
                      </select>
                    </label>
                    {effortChoiceOptions.length > 0 ? (
                      <div className="pluse-task-detail-field">
                        <span>{t('推理强度')}</span>
                        <SegmentedControl
                          value={resolveRuntimeEffortSelection(form.tool, form.effort, catalog)}
                          options={effortChoiceOptions}
                          ariaLabel={t('推理强度')}
                          onChange={(effort) => setForm((current) => ({ ...current, effort }))}
                        />
                      </div>
                    ) : null}
                    <div className="pluse-task-toggle-grid pluse-form-span">
                      <TaskSettingSwitch
                        label={t('继续上下文')}
                        note={t('保留当前 Quest 的上下文继续跑')}
                        checked={form.continueQuest}
                        onChange={(continueQuest) => setForm((current) => ({ ...current, continueQuest }))}
                      />
                      <TaskSettingSwitch
                        label={t('深度思考')}
                        note={t('需要时让模型展开更长推理')}
                        checked={form.thinking}
                        onChange={(thinking) => setForm((current) => ({ ...current, thinking }))}
                      />
                      <TaskSettingSwitch
                        label={t('完成后复盘')}
                        note={t('任务结束后补一条 review todo')}
                        checked={form.reviewOnComplete}
                        onChange={(reviewOnComplete) => setForm((current) => ({ ...current, reviewOnComplete }))}
                      />
                    </div>
                  </div>
                </section>

                <section className="pluse-task-detail-section">
                  <header className="pluse-task-detail-section-head">
                    <div>
                      <h3>{t('执行')}</h3>
                    </div>
                  </header>
                  <div className="pluse-form-grid pluse-task-detail-config-grid">
                    <div className="pluse-task-detail-field pluse-form-span">
                      <span>{t('执行类型')}</span>
                      <SegmentedControl
                        value={form.executorKind}
                        options={executorKindOptions}
                        ariaLabel={t('执行类型')}
                        onChange={(executorKind) => setForm((current) => ({ ...current, executorKind }))}
                      />
                    </div>
                    <label className="pluse-task-detail-field">
                      <span>{t('超时（秒）')}</span>
                      <input
                        value={form.timeout}
                        onChange={(event) => setForm((current) => ({ ...current, timeout: event.target.value }))}
                        placeholder="300"
                      />
                    </label>
                    {form.executorKind === 'ai_prompt' ? (
                      <label className="pluse-task-detail-field pluse-form-span">
                        <span>{t('提示词')}</span>
                        <textarea
                          rows={9}
                          value={form.prompt}
                          onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))}
                          placeholder={t('输入提示词')}
                        />
                      </label>
                    ) : (
                      <>
                        <label className="pluse-task-detail-field pluse-form-span">
                          <span>{t('命令')}</span>
                          <textarea
                            rows={4}
                            value={form.command}
                            onChange={(event) => setForm((current) => ({ ...current, command: event.target.value }))}
                            placeholder="pnpm test"
                          />
                        </label>
                        <label className="pluse-task-detail-field">
                          <span>{t('工作目录')}</span>
                          <input
                            value={form.workDir}
                            onChange={(event) => setForm((current) => ({ ...current, workDir: event.target.value }))}
                            placeholder="/abs/path"
                          />
                        </label>
                        <label className="pluse-task-detail-field pluse-form-span">
                          <span>{t('环境变量')}</span>
                          <textarea
                            rows={4}
                            value={form.envText}
                            onChange={(event) => setForm((current) => ({ ...current, envText: event.target.value }))}
                            placeholder={'FOO=bar\nNODE_ENV=production'}
                          />
                        </label>
                      </>
                    )}
                  </div>
                </section>

                <section className="pluse-task-detail-section">
                  <header className="pluse-task-detail-section-head">
                    <div>
                      <h3>{t('调度')}</h3>
                    </div>
                  </header>
                  <div className="pluse-form-grid pluse-task-detail-config-grid">
                    <div className="pluse-task-detail-field pluse-form-span">
                      <span>{t('调度方式')}</span>
                      <SegmentedControl
                        value={form.scheduleKind}
                        options={scheduleKindOptions}
                        ariaLabel={t('调度方式')}
                        onChange={(scheduleKind) => setForm((current) => ({ ...current, scheduleKind }))}
                      />
                    </div>
                    {form.scheduleKind === 'once' ? (
                      <p className="pluse-task-detail-inline-note pluse-form-span">{t('仅在你手动点击运行时执行。')}</p>
                    ) : null}
                    {form.scheduleKind === 'scheduled' ? (
                      <>
                        <div className="pluse-task-detail-field pluse-form-span">
                          <span>{t('快捷设置')}</span>
                          <div className="pluse-task-quick-presets">
                            {scheduledQuickOptions.map((option) => (
                              <button
                                key={option.id}
                                type="button"
                                className={`pluse-task-quick-preset${form.runAt === option.value ? ' is-active' : ''}`}
                                onClick={() => setForm((current) => ({ ...current, runAt: option.value }))}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <label className="pluse-task-detail-field">
                          <span>{t('运行时间')}</span>
                          <input
                            type="datetime-local"
                            value={form.runAt}
                            onChange={(event) => setForm((current) => ({ ...current, runAt: event.target.value }))}
                          />
                        </label>
                        <p className="pluse-task-detail-inline-note pluse-form-span">
                          {t('计划时间：{{time}}', { time: scheduledSummary })} · {t('自动按本机时区执行')}
                        </p>
                      </>
                    ) : null}
                    {form.scheduleKind === 'recurring' ? (
                      <>
                        <div className="pluse-task-detail-field pluse-form-span">
                          <span>{t('重复频率')}</span>
                          <SegmentedControl
                            value={form.recurringPreset}
                            options={recurringPresetOptions}
                            ariaLabel={t('重复频率')}
                            onChange={(recurringPreset) => setForm((current) => ({ ...current, recurringPreset }))}
                          />
                        </div>
                        {form.recurringPreset === 'custom' ? (
                          <label className="pluse-task-detail-field pluse-form-span">
                            <span>Cron</span>
                            <input
                              value={form.cron}
                              onChange={(event) => setForm((current) => ({ ...current, cron: event.target.value }))}
                              placeholder="0 9 * * 1-5"
                            />
                          </label>
                        ) : (
                          <>
                            <label className="pluse-task-detail-field">
                              <span>{t('执行时间')}</span>
                              <input
                                type="time"
                                value={form.recurringTime}
                                onChange={(event) => setForm((current) => ({ ...current, recurringTime: event.target.value }))}
                              />
                            </label>
                            {form.recurringPreset === 'weekly' ? (
                              <div className="pluse-task-detail-field pluse-form-span">
                                <span>{t('星期')}</span>
                                <SegmentedControl
                                  value={form.recurringWeekday}
                                  options={recurringWeekdayOptions}
                                  ariaLabel={t('星期')}
                                  onChange={(recurringWeekday) => setForm((current) => ({ ...current, recurringWeekday }))}
                                />
                              </div>
                            ) : null}
                            {form.recurringPreset === 'monthly' ? (
                              <label className="pluse-task-detail-field">
                                <span>{t('日期')}</span>
                                <input
                                  type="number"
                                  min="1"
                                  max="31"
                                  value={form.recurringMonthDay}
                                  onChange={(event) => setForm((current) => ({ ...current, recurringMonthDay: event.target.value }))}
                                />
                              </label>
                            ) : null}
                          </>
                        )}
                        <p className="pluse-task-detail-inline-note pluse-form-span">
                          {recurringSummary} · {t('自动按本机时区执行')}
                        </p>
                      </>
                    ) : null}
                  </div>
                  <div className="pluse-trigger-row">
                    <div className="pluse-trigger-item">
                      <span>{t('上次运行')}</span>
                      <strong>{formatDateTime(quest.scheduleConfig?.lastRunAt, locale, t)}</strong>
                    </div>
                    <div className="pluse-trigger-item">
                      <span>{t('下次运行')}</span>
                      <strong>{formatDateTime(quest.scheduleConfig?.nextRunAt, locale, t)}</strong>
                    </div>
                  </div>
                </section>

                <section className="pluse-task-detail-section">
                  <header className="pluse-task-detail-section-head">
                    <div>
                      <h3>{t('运行记录')}</h3>
                    </div>
                  </header>
                  <div className="pluse-output-list">
                    {runs.length > 0 ? runs.map((run) => (
                      <div key={run.id} className="pluse-note-item">
                        <div>
                          <strong>{formatStatus(run.state, t)}</strong>
                          <p>{run.tool}/{run.model} · {formatTrigger(run.trigger, t)} · {formatDateTime(run.createdAt, locale, t)}</p>
                          {run.failureReason ? <p>{run.failureReason}</p> : null}
                        </div>
                      </div>
                    )) : (
                      <p className="pluse-empty-inline">{t('暂无运行历史')}</p>
                    )}
                  </div>
                </section>

                <section className="pluse-task-detail-section">
                  <header className="pluse-task-detail-section-head">
                    <div>
                      <h3>{t('活动')}</h3>
                    </div>
                  </header>
                  <div className="pluse-output-list">
                    {ops.length > 0 ? ops.map((op) => (
                      <div key={op.id} className="pluse-note-item">
                        <div>
                          <strong>{formatOp(op.op, t)}</strong>
                          <p>{formatDateTime(op.createdAt, locale, t)} · {op.actor}</p>
                          {op.note ? <p>{op.note}</p> : null}
                          {!op.note && (op.fromStatus || op.toStatus) ? (
                            <p>{op.fromStatus ?? 'n/a'} → {op.toStatus ?? 'n/a'}</p>
                          ) : null}
                        </div>
                      </div>
                    )) : (
                      <p className="pluse-empty-inline">{t('暂无活动日志')}</p>
                    )}
                  </div>
                </section>

                {error ? <p className="pluse-error">{error}</p> : null}
              </div>
            </form>
          )}
        </section>
      </div>

      {quest ? (
        <TaskComposerModal
          open={createTaskModalOpen}
          projectId={quest.projectId}
          initialKind="human"
          originQuestId={quest.id}
          originQuestLabel={displayTaskName(quest.title ?? quest.name, t)}
          onClose={() => setCreateTaskModalOpen(false)}
          onCreated={async () => {
            await onDataChanged?.()
          }}
        />
      ) : null}
    </>
  )
}
