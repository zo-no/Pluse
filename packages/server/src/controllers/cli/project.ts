import { Command } from 'commander'
import type { OpenProjectInput, Project, UpdateProjectInput } from '@melody-sync/types'
import { getProject } from '../../models/project'
import { archiveProject, listVisibleProjects, openProject, updateProject } from '../../services/projects'
import { daemonRequest, getCliMode, resolveDaemonBaseUrl } from '../../support/cli-runtime'

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function printProject(project: { id: string; name: string; workDir: string; goal?: string; archived?: boolean; pinned?: boolean }): void {
  console.log(`${project.id}  ${project.name}`)
  console.log(`  workDir: ${project.workDir}`)
  if (project.goal) console.log(`  goal: ${project.goal}`)
  console.log(`  pinned: ${project.pinned ? 'yes' : 'no'}  archived: ${project.archived ? 'yes' : 'no'}`)
}

export const projectCommand = new Command('project')
projectCommand.description('Manage Pulse projects')

projectCommand
  .command('list')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: { json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    const projects: Project[] = baseUrl
      ? await daemonRequest<Project[]>(baseUrl, '/api/projects')
      : listVisibleProjects()
    opts.json ? printJson(projects) : projects.forEach(printProject)
  })

projectCommand
  .command('get <id>')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    const project: Project | null = baseUrl
      ? await daemonRequest<Project>(baseUrl, `/api/projects/${id}`)
      : getProject(id)
    if (!project) throw new Error(`Project not found: ${id}`)
    opts.json ? printJson(project) : printProject(project)
  })

projectCommand
  .command('open')
  .requiredOption('--work-dir <path>', 'Absolute work directory')
  .option('--name <name>', 'Project name')
  .option('--goal <goal>', 'Project goal')
  .option('--system-prompt <prompt>', 'Project system prompt')
  .option('--pin', 'Pin the project', false)
  .option('--json', 'Output as JSON', false)
  .action(async (opts: { workDir: string; name?: string; goal?: string; systemPrompt?: string; pin: boolean; json: boolean }) => {
    const mode = getCliMode()
    const input: OpenProjectInput = {
      workDir: opts.workDir,
      name: opts.name,
      goal: opts.goal,
      systemPrompt: opts.systemPrompt,
      pinned: opts.pin || undefined,
    }
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const project: Project = baseUrl
      ? await daemonRequest<Project>(baseUrl, '/api/projects/open', { method: 'POST', body: JSON.stringify(input) })
      : openProject(input)
    opts.json ? printJson(project) : printProject(project)
  })

projectCommand
  .command('update <id>')
  .option('--name <name>', 'New name')
  .option('--goal <goal>', 'New goal')
  .option('--system-prompt <prompt>', 'New project system prompt')
  .option('--pin', 'Pin the project')
  .option('--unpin', 'Unpin the project')
  .option('--archive', 'Archive the project')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { name?: string; goal?: string; systemPrompt?: string; pin?: boolean; unpin?: boolean; archive?: boolean; json: boolean }) => {
    const patch: UpdateProjectInput = {
      name: opts.name,
      goal: opts.goal,
      systemPrompt: opts.systemPrompt,
      pinned: opts.pin ? true : opts.unpin ? false : undefined,
      archived: opts.archive ? true : undefined,
    }
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const project: Project = baseUrl
      ? await daemonRequest<Project>(baseUrl, `/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      : updateProject(id, patch)
    opts.json ? printJson(project) : printProject(project)
  })

projectCommand
  .command('archive <id>')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const project: Project = baseUrl
      ? await daemonRequest<Project>(baseUrl, `/api/projects/${id}/archive`, { method: 'POST' })
      : archiveProject(id)
    opts.json ? printJson(project) : printProject(project)
  })
