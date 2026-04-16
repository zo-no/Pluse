import { Command } from 'commander'
import type { Run } from '@melody-sync/types'
import { getRun, getRunsBySession, cancelRun } from '../../models/run'

// ─── formatting helpers ───────────────────────────────────────────────────────

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function printRun(r: Run): void {
  console.log(`${r.id}  state: ${r.state}`)
  console.log(`  session: ${r.sessionId}  request: ${r.requestId}`)
  console.log(`  model: ${r.model}`)
  if (r.result) console.log(`  result: ${r.result}`)
  if (r.failureReason) console.log(`  failure: ${r.failureReason}`)
  console.log(`  created: ${r.createdAt}  updated: ${r.updatedAt}`)
  if (r.completedAt) console.log(`  completed: ${r.completedAt}`)
}

function printRuns(list: Run[]): void {
  if (list.length === 0) {
    console.log('(no runs)')
    return
  }
  for (const r of list) {
    const elapsed = r.completedAt
      ? `${((new Date(r.completedAt).getTime() - new Date(r.createdAt).getTime()) / 1000).toFixed(1)}s`
      : 'in progress'
    console.log(`${r.id}  ${r.state.padEnd(12)}  ${r.model}  ${elapsed}`)
  }
}

// ─── command ──────────────────────────────────────────────────────────────────

export const runCommand = new Command('run')
runCommand.description('Inspect and manage runs')

// run status
runCommand
  .command('status <id>')
  .description('Get run status')
  .option('--json', 'Output as JSON', false)
  .action((id: string, opts: { json: boolean }) => {
    try {
      const run = getRun(id)
      if (!run) {
        console.error(`Run not found: ${id}`)
        process.exit(1)
      }
      opts.json ? printJson(run) : printRun(run)
    } catch (e) {
      console.error('Error:', String(e))
      process.exit(1)
    }
  })

// run list
runCommand
  .command('list <sessionId>')
  .description('List all runs for a session')
  .option('--json', 'Output as JSON', false)
  .action((sessionId: string, opts: { json: boolean }) => {
    try {
      const runs = getRunsBySession(sessionId)
      opts.json ? printJson(runs) : printRuns(runs)
    } catch (e) {
      console.error('Error:', String(e))
      process.exit(1)
    }
  })

// run cancel
runCommand
  .command('cancel <id>')
  .description('Request cancellation of a run')
  .option('--json', 'Output as JSON', false)
  .action((id: string, opts: { json: boolean }) => {
    try {
      const run = cancelRun(id)
      opts.json ? printJson(run) : console.log(`Cancel requested for run: ${run.id}  (state: ${run.state})`)
    } catch (e) {
      console.error('Error:', String(e))
      process.exit(1)
    }
  })
