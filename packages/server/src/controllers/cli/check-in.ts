import { Command } from 'commander'
import type {
  CheckIn,
  CheckInListOrder,
  CheckInPriority,
  CheckInRecord,
  CompleteCheckInInput,
  CreateCheckInInput,
  UpdateCheckInInput,
} from '@pluse/types'
import { getCheckIn, listCheckInRecords } from '../../models/check-in'
import {
  completeCheckInWithEffects,
  createCheckInWithEffects,
  deleteCheckInWithEffects,
  listCheckInViews,
  updateCheckInWithEffects,
} from '../../services/check-ins'
import { daemonRequest, getCliMode, resolveDaemonBaseUrl } from '../../support/cli-runtime'

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function printCheckIn(item: CheckIn): void {
  const priorityMark = item.priority !== 'normal' ? ` [${item.priority}]` : ''
  console.log(`${item.id}${priorityMark}  ${item.title}`)
  console.log(`  project: ${item.projectId}`)
  if (item.originQuestId) console.log(`  quest: ${item.originQuestId}`)
  if (item.originRunId) console.log(`  run: ${item.originRunId}`)
  if (item.remindAt) console.log(`  remind: ${item.remindAt}`)
  if (item.body) console.log(`  body: ${item.body}`)
}

function printCheckInRecord(record: CheckInRecord): void {
  console.log(`${record.id}  ${record.title}`)
  console.log(`  project: ${record.projectId}`)
  console.log(`  check-in: ${record.checkInId}`)
  console.log(`  checked: ${record.checkedAt}`)
  if (record.originQuestId) console.log(`  quest: ${record.originQuestId}`)
  if (record.originRunId) console.log(`  run: ${record.originRunId}`)
  if (record.remindAt) console.log(`  remind: ${record.remindAt}`)
  if (record.note) console.log(`  note: ${record.note}`)
}

async function fetchCheckIn(id: string): Promise<CheckIn> {
  const mode = getCliMode()
  const baseUrl = await resolveDaemonBaseUrl(mode)
  const item = baseUrl ? await daemonRequest<CheckIn>(baseUrl, `/api/check-ins/${id}`) : getCheckIn(id)
  if (!item) throw new Error(`Check-in not found: ${id}`)
  return item
}

async function patchCheckIn(id: string, patch: UpdateCheckInInput): Promise<CheckIn> {
  const mode = getCliMode()
  const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
  return baseUrl
    ? await daemonRequest<CheckIn>(baseUrl, `/api/check-ins/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
    : updateCheckInWithEffects(id, patch)
}

async function completeCheckIn(id: string, input: CompleteCheckInInput): Promise<CheckInRecord> {
  const mode = getCliMode()
  const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
  return baseUrl
    ? await daemonRequest<CheckInRecord>(
        baseUrl,
        `/api/check-ins/${id}/complete`,
        { method: 'POST', body: JSON.stringify(input) },
      )
    : completeCheckInWithEffects(id, input)
}

export const checkInCommand = new Command('check-in')
checkInCommand.description('Manage check-ins')

checkInCommand
  .command('list')
  .option('--project-id <id>', 'Project id')
  .option('--priority <priority>', 'urgent, high, normal, or low')
  .option('--origin-quest-id <id>', 'Origin quest')
  .option('--origin-run-id <id>', 'Origin run')
  .option('--time <time>', 'all, due, or future')
  .option('--order <order>', 'attention or time')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: {
    projectId?: string
    priority?: CheckInPriority
    originQuestId?: string
    originRunId?: string
    time?: 'all' | 'due' | 'future'
    order?: CheckInListOrder
    json: boolean
  }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    const params = new URLSearchParams()
    if (opts.projectId) params.set('projectId', opts.projectId)
    if (opts.priority) params.set('priority', opts.priority)
    if (opts.originQuestId) params.set('originQuestId', opts.originQuestId)
    if (opts.originRunId) params.set('originRunId', opts.originRunId)
    if (opts.time) params.set('time', opts.time)
    if (opts.order) params.set('order', opts.order)
    const items = baseUrl
      ? await daemonRequest<CheckIn[]>(baseUrl, `/api/check-ins${params.toString() ? `?${params.toString()}` : ''}`)
      : listCheckInViews({
          projectId: opts.projectId,
          priority: opts.priority,
          originQuestId: opts.originQuestId,
          originRunId: opts.originRunId,
          time: opts.time,
          order: opts.order,
        })
    opts.json ? printJson(items) : items.forEach(printCheckIn)
  })

checkInCommand
  .command('records')
  .option('--project-id <id>', 'Project id')
  .option('--check-in-id <id>', 'Source check-in id')
  .option('--origin-quest-id <id>', 'Origin quest')
  .option('--origin-run-id <id>', 'Origin run')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: {
    projectId?: string
    checkInId?: string
    originQuestId?: string
    originRunId?: string
    json: boolean
  }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    const params = new URLSearchParams()
    if (opts.projectId) params.set('projectId', opts.projectId)
    if (opts.checkInId) params.set('checkInId', opts.checkInId)
    if (opts.originQuestId) params.set('originQuestId', opts.originQuestId)
    if (opts.originRunId) params.set('originRunId', opts.originRunId)
    const records = baseUrl
      ? await daemonRequest<CheckInRecord[]>(
          baseUrl,
          `/api/check-in-records${params.toString() ? `?${params.toString()}` : ''}`,
        )
      : listCheckInRecords({
          projectId: opts.projectId,
          checkInId: opts.checkInId,
          originQuestId: opts.originQuestId,
          originRunId: opts.originRunId,
        })
    opts.json ? printJson(records) : records.forEach(printCheckInRecord)
  })

checkInCommand
  .command('get <id>')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { json: boolean }) => {
    const item = await fetchCheckIn(id)
    opts.json ? printJson(item) : printCheckIn(item)
  })

checkInCommand
  .command('create')
  .requiredOption('--project-id <id>', 'Project id')
  .requiredOption('--title <title>', 'Check-in title')
  .option('--body <body>', 'Check-in body')
  .option('--remind-at <time>', 'Reminder time (ISO 8601)')
  .option('--priority <priority>', 'urgent, high, normal, or low')
  .option('--origin-quest-id <id>', 'Origin quest')
  .option('--origin-run-id <id>', 'Origin run')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: {
    projectId: string
    title: string
    body?: string
    remindAt?: string
    priority?: CheckInPriority
    originQuestId?: string
    originRunId?: string
    json: boolean
  }) => {
    const input: CreateCheckInInput = {
      projectId: opts.projectId,
      title: opts.title,
      body: opts.body,
      remindAt: opts.remindAt,
      priority: opts.priority,
      originQuestId: opts.originQuestId,
      originRunId: opts.originRunId,
      createdBy: 'ai',
    }
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const item = baseUrl
      ? await daemonRequest<CheckIn>(baseUrl, '/api/check-ins', { method: 'POST', body: JSON.stringify(input) })
      : createCheckInWithEffects(input)
    opts.json ? printJson(item) : printCheckIn(item)
  })

checkInCommand
  .command('update <id>')
  .option('--title <title>', 'Check-in title')
  .option('--body <body>', 'Check-in body')
  .option('--remind-at <time>', 'Reminder time (ISO 8601)')
  .option('--clear-remind', 'Clear reminder time', false)
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
    priority?: CheckInPriority
    originQuestId?: string
    clearOriginQuest: boolean
    originRunId?: string
    clearOriginRun: boolean
    json: boolean
  }) => {
    const patch: UpdateCheckInInput = {
      title: opts.title,
      body: opts.body,
      priority: opts.priority,
    }
    if (opts.clearRemind) patch.remindAt = null
    else if (opts.remindAt) patch.remindAt = opts.remindAt
    if (opts.clearOriginQuest) patch.originQuestId = null
    else if (opts.originQuestId) patch.originQuestId = opts.originQuestId
    if (opts.clearOriginRun) patch.originRunId = null
    else if (opts.originRunId) patch.originRunId = opts.originRunId

    const item = await patchCheckIn(id, patch)
    opts.json ? printJson(item) : printCheckIn(item)
  })

checkInCommand
  .command('complete <id>')
  .option('--note <note>', 'Optional check-in note')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { note?: string; json: boolean }) => {
    const record = await completeCheckIn(id, {
      createdBy: 'human',
      note: opts.note,
    })
    opts.json ? printJson(record) : printCheckInRecord(record)
  })

checkInCommand
  .command('delete <id>')
  .option('--confirm', 'Skip confirmation prompt', false)
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { confirm: boolean; json: boolean }) => {
    if (!opts.confirm) {
      console.error('Add --confirm to delete this check-in.')
      process.exit(1)
    }
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    if (baseUrl) {
      await daemonRequest(baseUrl, `/api/check-ins/${id}`, { method: 'DELETE' })
    } else {
      deleteCheckInWithEffects(id)
    }
    opts.json ? printJson({ deleted: true }) : console.log(`Check-in ${id} deleted.`)
  })
