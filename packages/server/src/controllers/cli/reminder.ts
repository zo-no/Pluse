import { Command } from 'commander'
import type {
  CreateReminderInput,
  Reminder,
  ReminderListOrder,
  ReminderPriority,
  ReminderProjectPriority,
  ReminderProjectPrioritySetting,
  ReminderType,
  SetReminderProjectPriorityResult,
  UpdateReminderInput,
} from '@pluse/types'
import { getReminder } from '../../models/reminder'
import {
  createReminderWithEffects,
  deleteReminderWithEffects,
  listReminderProjectPriorities,
  listReminderViews,
  setReminderProjectPriorityWithEffects,
  updateReminderWithEffects,
} from '../../services/reminders'
import { daemonRequest, getCliMode, resolveDaemonBaseUrl } from '../../support/cli-runtime'

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function printReminder(reminder: Reminder): void {
  const priorityMark = reminder.priority !== 'normal' ? ` [${reminder.priority}]` : ''
  console.log(`${reminder.id}${priorityMark}  ${reminder.title}`)
  console.log(`  project: ${reminder.projectId}`)
  console.log(`  type: ${reminder.type}`)
  if (reminder.originQuestId) console.log(`  quest: ${reminder.originQuestId}`)
  if (reminder.originRunId) console.log(`  run: ${reminder.originRunId}`)
  if (reminder.remindAt) console.log(`  remind: ${reminder.remindAt}`)
  if (reminder.body) console.log(`  body: ${reminder.body}`)
}

function projectPriorityLabel(priority: ReminderProjectPriority): string {
  if (priority === 'mainline') return 'mainline'
  if (priority === 'priority') return 'priority'
  return 'normal'
}

function printProjectPriority(setting: ReminderProjectPrioritySetting): void {
  console.log(`${setting.projectId}  ${projectPriorityLabel(setting.priority)}`)
  if (setting.updatedAt) console.log(`  updated: ${setting.updatedAt}`)
}

async function fetchReminder(id: string): Promise<Reminder> {
  const mode = getCliMode()
  const baseUrl = await resolveDaemonBaseUrl(mode)
  const reminder = baseUrl ? await daemonRequest<Reminder>(baseUrl, `/api/reminders/${id}`) : getReminder(id)
  if (!reminder) throw new Error(`Reminder not found: ${id}`)
  return reminder
}

async function patchReminder(id: string, patch: UpdateReminderInput): Promise<Reminder> {
  const mode = getCliMode()
  const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
  return baseUrl
    ? await daemonRequest<Reminder>(baseUrl, `/api/reminders/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
    : updateReminderWithEffects(id, patch)
}

export const reminderCommand = new Command('reminder')
reminderCommand.description('Manage reminders')

reminderCommand
  .command('list')
  .option('--project-id <id>', 'Project id')
  .option('--type <type>', 'custom, review, follow_up, needs_input, or failure')
  .option('--priority <priority>', 'urgent, high, normal, or low')
  .option('--origin-quest-id <id>', 'Origin quest')
  .option('--origin-run-id <id>', 'Origin run')
  .option('--time <time>', 'all, due, or future')
  .option('--order <order>', 'attention or time')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: {
    projectId?: string
    type?: ReminderType
    priority?: ReminderPriority
    originQuestId?: string
    originRunId?: string
    time?: 'all' | 'due' | 'future'
    order?: ReminderListOrder
    json: boolean
  }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    const params = new URLSearchParams()
    if (opts.projectId) params.set('projectId', opts.projectId)
    if (opts.type) params.set('type', opts.type)
    if (opts.priority) params.set('priority', opts.priority)
    if (opts.originQuestId) params.set('originQuestId', opts.originQuestId)
    if (opts.originRunId) params.set('originRunId', opts.originRunId)
    if (opts.time) params.set('time', opts.time)
    if (opts.order) params.set('order', opts.order)
    const reminders = baseUrl
      ? await daemonRequest<Reminder[]>(baseUrl, `/api/reminders${params.toString() ? `?${params.toString()}` : ''}`)
      : listReminderViews({
          projectId: opts.projectId,
          type: opts.type,
          priority: opts.priority,
          originQuestId: opts.originQuestId,
          originRunId: opts.originRunId,
          time: opts.time,
          order: opts.order,
        })
    opts.json ? printJson(reminders) : reminders.forEach(printReminder)
  })

const projectPriorityCommand = reminderCommand
  .command('project-priority')
  .description('Manage reminder project priorities')

projectPriorityCommand
  .command('list')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: { json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    const settings = baseUrl
      ? await daemonRequest<ReminderProjectPrioritySetting[]>(baseUrl, '/api/reminders/project-priorities')
      : listReminderProjectPriorities()
    opts.json ? printJson(settings) : settings.forEach(printProjectPriority)
  })

projectPriorityCommand
  .command('set <project-id>')
  .requiredOption('--priority <priority>', 'mainline, priority, or normal')
  .option('--json', 'Output as JSON', false)
  .action(async (projectId: string, opts: { priority: ReminderProjectPriority; json: boolean }) => {
    const input = { priority: opts.priority }
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const result = baseUrl
      ? await daemonRequest<SetReminderProjectPriorityResult>(
          baseUrl,
          `/api/reminders/project-priorities/${projectId}`,
          { method: 'PATCH', body: JSON.stringify(input) },
        )
      : setReminderProjectPriorityWithEffects(projectId, opts.priority)
    if (opts.json) printJson(result)
    else printProjectPriority(result.setting)
  })

reminderCommand
  .command('get <id>')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { json: boolean }) => {
    const reminder = await fetchReminder(id)
    opts.json ? printJson(reminder) : printReminder(reminder)
  })

reminderCommand
  .command('create')
  .requiredOption('--project-id <id>', 'Project id')
  .requiredOption('--title <title>', 'Reminder title')
  .option('--body <body>', 'Reminder body')
  .option('--remind-at <time>', 'Reminder time (ISO 8601)')
  .option('--type <type>', 'custom, review, follow_up, needs_input, or failure')
  .option('--priority <priority>', 'urgent, high, normal, or low')
  .option('--origin-quest-id <id>', 'Origin quest')
  .option('--origin-run-id <id>', 'Origin run')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: {
    projectId: string
    title: string
    body?: string
    remindAt?: string
    type?: ReminderType
    priority?: ReminderPriority
    originQuestId?: string
    originRunId?: string
    json: boolean
  }) => {
    const input: CreateReminderInput = {
      projectId: opts.projectId,
      title: opts.title,
      body: opts.body,
      remindAt: opts.remindAt,
      type: opts.type,
      priority: opts.priority,
      originQuestId: opts.originQuestId,
      originRunId: opts.originRunId,
      createdBy: 'ai',
    }
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const reminder = baseUrl
      ? await daemonRequest<Reminder>(baseUrl, '/api/reminders', { method: 'POST', body: JSON.stringify(input) })
      : createReminderWithEffects(input)
    opts.json ? printJson(reminder) : printReminder(reminder)
  })

reminderCommand
  .command('update <id>')
  .option('--title <title>', 'Reminder title')
  .option('--body <body>', 'Reminder body')
  .option('--remind-at <time>', 'Reminder time (ISO 8601)')
  .option('--clear-remind', 'Clear reminder time', false)
  .option('--type <type>', 'custom, review, follow_up, needs_input, or failure')
  .option('--priority <priority>', 'urgent, high, normal, or low')
  .option('--origin-quest-id <id>', 'Origin quest')
  .option('--clear-origin-quest', 'Clear origin quest', false)
  .option('--origin-run-id <id>', 'Origin run')
  .option('--clear-origin-run', 'Clear origin run', false)
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: {
    title?: string
    body?: string
    remindAt?: string
    clearRemind: boolean
    type?: ReminderType
    priority?: ReminderPriority
    originQuestId?: string
    clearOriginQuest: boolean
    originRunId?: string
    clearOriginRun: boolean
    json: boolean
  }) => {
    const patch: UpdateReminderInput = {
      title: opts.title,
      body: opts.body,
      type: opts.type,
      priority: opts.priority,
    }
    if (opts.clearRemind) patch.remindAt = null
    else if (opts.remindAt) patch.remindAt = opts.remindAt
    if (opts.clearOriginQuest) patch.originQuestId = null
    else if (opts.originQuestId) patch.originQuestId = opts.originQuestId
    if (opts.clearOriginRun) patch.originRunId = null
    else if (opts.originRunId) patch.originRunId = opts.originRunId

    const reminder = await patchReminder(id, patch)
    opts.json ? printJson(reminder) : printReminder(reminder)
  })

reminderCommand
  .command('snooze <id>')
  .requiredOption('--until <time>', 'Next reminder time (ISO 8601)')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { until: string; json: boolean }) => {
    const reminder = await patchReminder(id, { remindAt: opts.until })
    opts.json ? printJson(reminder) : printReminder(reminder)
  })

reminderCommand
  .command('delete <id>')
  .option('--confirm', 'Skip confirmation prompt', false)
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { confirm: boolean; json: boolean }) => {
    if (!opts.confirm) {
      console.error('Add --confirm to delete this reminder.')
      process.exit(1)
    }
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    if (baseUrl) {
      await daemonRequest(baseUrl, `/api/reminders/${id}`, { method: 'DELETE' })
    } else {
      deleteReminderWithEffects(id)
    }
    opts.json ? printJson({ deleted: true }) : console.log(`Reminder ${id} deleted.`)
  })
