import { Command } from 'commander'
import type { Run } from '@pluse/types'
import { getRun, getRunSpool, getRunsByQuest } from '../../models/run'
import { cancelActiveRun } from '../../runtime/session-runner'
import { daemonRequest, getCliMode, resolveDaemonBaseUrl } from '../../support/cli-runtime'

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function printRun(run: Run): void {
  console.log(`${run.id}  ${run.state}`)
  console.log(`  quest: ${run.questId}  request: ${run.requestId}`)
  console.log(`  trigger: ${run.trigger}  by: ${run.triggeredBy}`)
  console.log(`  tool: ${run.tool}  model: ${run.model}`)
  if (run.failureReason) console.log(`  failure: ${run.failureReason}`)
  console.log(`  created: ${run.createdAt}`)
  if (run.startedAt) console.log(`  started: ${run.startedAt}`)
  if (run.completedAt) console.log(`  completed: ${run.completedAt}`)
}

export const runCommand = new Command('run')
runCommand.description('Inspect and manage quest runs')

runCommand
  .command('get <id>')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    const run: Run | null = baseUrl ? await daemonRequest<Run>(baseUrl, `/api/runs/${id}`) : getRun(id)
    if (!run) throw new Error(`Run not found: ${id}`)
    opts.json ? printJson(run) : printRun(run)
  })

runCommand
  .command('list <questId>')
  .option('--json', 'Output as JSON', false)
  .action(async (questId: string, opts: { json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    const runs = baseUrl ? await daemonRequest<Run[]>(baseUrl, `/api/quests/${questId}/runs`) : getRunsByQuest(questId)
    if (opts.json) {
      printJson(runs)
      return
    }
    if (runs.length === 0) {
      console.log('(no runs)')
      return
    }
    for (const run of runs) {
      console.log(`${run.id}  ${run.state.padEnd(10)}  ${run.tool}/${run.model}`)
    }
  })

runCommand
  .command('spool <id>')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    const spool = baseUrl
      ? await daemonRequest<Array<{ id: number; ts: string; line: string }>>(baseUrl, `/api/runs/${id}/spool`)
      : getRunSpool(id)
    if (opts.json) {
      printJson(spool)
      return
    }
    for (const line of spool) {
      console.log(line.line)
    }
  })

runCommand
  .command('cancel <id>')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const run = baseUrl
      ? await daemonRequest<Run>(baseUrl, `/api/runs/${id}/cancel`, { method: 'POST' })
      : cancelActiveRun(id)
    opts.json ? printJson(run) : console.log(`Cancel requested for ${run.id}`)
  })
