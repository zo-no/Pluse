import { Command } from 'commander'
import type { CreateSessionInput, CreateTaskInput, Session, Task, UpdateSessionInput } from '@pluse/types'
import { getSession } from '../../models/session'
import { createTask } from '../../models/task'
import { INBOX_PROJECT_ID } from '../../services/projects'
import { createSessionWithEffects, listSessionViews, updateSessionWithEffects } from '../../services/sessions'
import { daemonRequest, getCliMode, resolveDaemonBaseUrl } from '../../support/cli-runtime'

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

export const sessionCommand = new Command('session')
sessionCommand.description('Manage Pluse sessions')

sessionCommand
  .command('list')
  .option('--project-id <id>', 'Filter by project id')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: { projectId?: string; json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    const path = opts.projectId ? `/api/sessions?projectId=${encodeURIComponent(opts.projectId)}` : '/api/sessions'
    const sessions: Session[] = baseUrl ? await daemonRequest<Session[]>(baseUrl, path) : listSessionViews(opts.projectId)
    opts.json ? printJson(sessions) : sessions.forEach((session) => console.log(`${session.id}  ${session.name}`))
  })

sessionCommand
  .command('get <id>')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    const session: Session | null = baseUrl ? await daemonRequest<Session>(baseUrl, `/api/sessions/${id}`) : getSession(id)
    if (!session) throw new Error(`Session not found: ${id}`)
    opts.json ? printJson(session) : console.log(`${session.id}  ${session.name}`)
  })

sessionCommand
  .command('create')
  .option('--project-id <id>', 'Owning project id')
  .option('--name <name>', 'Session name')
  .option('--tool <tool>', 'Runtime tool')
  .option('--model <model>', 'Model id')
  .option('--effort <effort>', 'Reasoning effort')
  .option('--thinking', 'Enable thinking mode')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: { projectId?: string; name?: string; tool?: string; model?: string; effort?: string; thinking?: boolean; json: boolean }) => {
    const input: CreateSessionInput = {
      projectId: opts.projectId || INBOX_PROJECT_ID,
      name: opts.name,
      tool: opts.tool,
      model: opts.model ?? null,
      effort: opts.effort ?? null,
      thinking: opts.thinking,
    }
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const session: Session = baseUrl
      ? await daemonRequest<Session>(baseUrl, '/api/sessions', { method: 'POST', body: JSON.stringify(input) })
      : createSessionWithEffects(input)
    opts.json ? printJson(session) : console.log(`${session.id}  ${session.name}`)
  })

sessionCommand
  .command('update <id>')
  .option('--name <name>', 'New session name')
  .option('--tool <tool>', 'Runtime tool')
  .option('--model <model>', 'Model id')
  .option('--effort <effort>', 'Reasoning effort')
  .option('--thinking', 'Enable thinking mode')
  .option('--no-thinking', 'Disable thinking mode')
  .option('--pin', 'Pin the session')
  .option('--unpin', 'Unpin the session')
  .option('--archive', 'Archive the session')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { name?: string; tool?: string; model?: string; effort?: string; thinking?: boolean; pin?: boolean; unpin?: boolean; archive?: boolean; json: boolean }) => {
    const patch: UpdateSessionInput = {
      name: opts.name,
      tool: opts.tool,
      model: opts.model ?? undefined,
      effort: opts.effort ?? undefined,
      thinking: opts.thinking,
      pinned: opts.pin ? true : opts.unpin ? false : undefined,
      archived: opts.archive ? true : undefined,
    }
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const session: Session = baseUrl
      ? await daemonRequest<Session>(baseUrl, `/api/sessions/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      : updateSessionWithEffects(id, patch)
    opts.json ? printJson(session) : console.log(`${session.id}  ${session.name}`)
  })

sessionCommand
  .command('create-task <sessionId>')
  .requiredOption('--title <title>', 'Task title')
  .requiredOption('--assignee <assignee>', 'ai or human')
  .option('--description <description>', 'Task description')
  .option('--waiting-instructions <text>', 'Human task guidance')
  .option('--review-on-complete', 'Create a human review task on completion')
  .option('--json', 'Output as JSON', false)
  .action(async (sessionId: string, opts: any) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const body = {
      title: opts.title,
      assignee: opts.assignee,
      description: opts.description,
      waitingInstructions: opts.waitingInstructions,
      reviewOnComplete: opts.reviewOnComplete,
    }
    const task: Task = baseUrl
      ? await daemonRequest<Task>(baseUrl, `/api/sessions/${sessionId}/create-task`, { method: 'POST', body: JSON.stringify(body) })
      : (() => {
          const session = getSession(sessionId)
          if (!session) throw new Error(`Session not found: ${sessionId}`)
          return createTask({
            projectId: session.projectId,
            originSessionId: session.id,
            sessionId: session.id,
            title: opts.title,
            assignee: opts.assignee,
            kind: 'once',
            createdBy: 'human',
            description: opts.description,
            waitingInstructions: opts.waitingInstructions,
            reviewOnComplete: opts.reviewOnComplete,
          } as CreateTaskInput)
        })()
    opts.json ? printJson(task) : console.log(`${task.id}  ${task.title}`)
  })
