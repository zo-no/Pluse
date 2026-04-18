import { Command } from 'commander'
import type { CreateQuestInput, Quest, UpdateQuestInput } from '@pluse/types'
import { getQuest, listQuests } from '../../models/quest'
import type { StartQuestRunResult, SubmitQuestMessageResult } from '../../runtime/session-runner'
import { startQuestRun, submitQuestMessage } from '../../runtime/session-runner'
import { createQuestWithEffects, deleteQuestWithEffects, updateQuestWithEffects } from '../../services/quests'
import { daemonRequest, getCliMode, resolveDaemonBaseUrl } from '../../support/cli-runtime'

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function printQuest(quest: Quest): void {
  console.log(`${quest.id}  ${quest.kind}  ${quest.name ?? quest.title ?? 'Untitled'}`)
  console.log(`  project: ${quest.projectId}`)
  console.log(`  status: ${quest.status ?? 'n/a'}  tool: ${quest.tool ?? 'codex'}`)
}

export const questCommand = new Command('quest')
questCommand.description('Manage quests')

questCommand
  .command('list')
  .option('--project-id <id>', 'Project id')
  .option('--kind <kind>', 'session or task')
  .option('--status <status>', 'Quest status')
  .option('--search <query>', 'Search string')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: { projectId?: string; kind?: Quest['kind']; status?: Quest['status']; search?: string; json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    const params = new URLSearchParams()
    if (opts.projectId) params.set('projectId', opts.projectId)
    if (opts.kind) params.set('kind', opts.kind)
    if (opts.status) params.set('status', opts.status)
    if (opts.search) params.set('search', opts.search)
    const quests = baseUrl
      ? await daemonRequest<Quest[]>(baseUrl, `/api/quests${params.toString() ? `?${params.toString()}` : ''}`)
      : listQuests({ projectId: opts.projectId, kind: opts.kind, status: opts.status, deleted: false })
    if (opts.json) {
      printJson(quests)
      return
    }
    quests.forEach(printQuest)
  })

questCommand
  .command('get <id>')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    const quest = baseUrl ? await daemonRequest<Quest>(baseUrl, `/api/quests/${id}`) : getQuest(id)
    if (!quest) throw new Error(`Quest not found: ${id}`)
    opts.json ? printJson(quest) : printQuest(quest)
  })

questCommand
  .command('create')
  .requiredOption('--project-id <id>', 'Project id')
  .requiredOption('--kind <kind>', 'session or task')
  .option('--name <name>', 'Session-style name')
  .option('--title <title>', 'Task-style title')
  .option('--description <description>', 'Description')
  .option('--tool <tool>', 'codex or claude')
  .option('--model <model>', 'Model id')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: { projectId: string; kind: Quest['kind']; name?: string; title?: string; description?: string; tool?: string; model?: string; json: boolean }) => {
    const input: CreateQuestInput = {
      projectId: opts.projectId,
      kind: opts.kind,
      name: opts.name,
      title: opts.title,
      description: opts.description,
      tool: opts.tool,
      model: opts.model,
      createdBy: 'human',
    }
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const quest = baseUrl
      ? await daemonRequest<Quest>(baseUrl, '/api/quests', { method: 'POST', body: JSON.stringify(input) })
      : createQuestWithEffects(input)
    opts.json ? printJson(quest) : printQuest(quest)
  })

questCommand
  .command('update <id>')
  .option('--kind <kind>', 'session or task')
  .option('--name <name>', 'Name')
  .option('--title <title>', 'Title')
  .option('--description <description>', 'Description')
  .option('--status <status>', 'Status')
  .option('--tool <tool>', 'Tool')
  .option('--model <model>', 'Model')
  .option('--pin', 'Pin quest')
  .option('--unpin', 'Unpin quest')
  .option('--enable', 'Enable quest')
  .option('--disable', 'Disable quest')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { kind?: Quest['kind']; name?: string; title?: string; description?: string; status?: Quest['status']; tool?: string; model?: string; pin?: boolean; unpin?: boolean; enable?: boolean; disable?: boolean; json: boolean }) => {
    const patch: UpdateQuestInput = {
      kind: opts.kind,
      name: opts.name,
      title: opts.title,
      description: opts.description,
      status: opts.status,
      tool: opts.tool,
      model: opts.model,
      pinned: opts.pin ? true : opts.unpin ? false : undefined,
      enabled: opts.enable ? true : opts.disable ? false : undefined,
    }
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const quest = baseUrl
      ? await daemonRequest<Quest>(baseUrl, `/api/quests/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      : updateQuestWithEffects(id, patch)
    opts.json ? printJson(quest) : printQuest(quest)
  })

questCommand
  .command('delete <id>')
  .option('--confirm', 'Skip confirmation prompt', false)
  .action(async (id: string, opts: { confirm: boolean }) => {
    if (!opts.confirm) {
      console.error('Add --confirm to permanently delete this quest.')
      process.exit(1)
    }
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    if (baseUrl) {
      await daemonRequest(baseUrl, `/api/quests/${id}`, { method: 'DELETE' })
    } else {
      deleteQuestWithEffects(id)
    }
    console.log(`Quest ${id} deleted.`)
  })

questCommand
  .command('message <id>')
  .requiredOption('--text <text>', 'Message text')
  .option('--tool <tool>', 'codex or claude')
  .option('--model <model>', 'Model id')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { text: string; tool?: string; model?: string; json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const result: SubmitQuestMessageResult = baseUrl
      ? await daemonRequest<SubmitQuestMessageResult>(baseUrl, `/api/quests/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text: opts.text, tool: opts.tool, model: opts.model }),
      })
      : submitQuestMessage({ questId: id, text: opts.text, tool: opts.tool, model: opts.model })
    opts.json ? printJson(result) : console.log(result.queued ? 'Queued' : `Started ${result.run?.id ?? ''}`.trim())
  })

questCommand
  .command('run <id>')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const result: StartQuestRunResult = baseUrl
      ? await daemonRequest<StartQuestRunResult>(baseUrl, `/api/quests/${id}/run`, { method: 'POST', body: JSON.stringify({ trigger: 'manual', triggeredBy: 'cli' }) })
      : await startQuestRun({ questId: id, trigger: 'manual', triggeredBy: 'cli' })
    opts.json ? printJson(result) : console.log(result.skipped ? 'Skipped' : `Started ${result.run?.id ?? ''}`.trim())
  })
