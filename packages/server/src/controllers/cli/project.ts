import { Command } from 'commander'
import type { OpenProjectInput, Project, ProjectOverview, UpdateProjectInput } from '@pluse/types'
import { getProject } from '../../models/project'
import { archiveProject, deleteProjectWithCascade, getProjectOverview, listVisibleProjects, openProject, updateProject } from '../../services/projects'
import { daemonRequest, getCliMode, resolveDaemonBaseUrl } from '../../support/cli-runtime'

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function printProject(project: { id: string; name: string; workDir: string; goal?: string; description?: string; domainId?: string; archived?: boolean; pinned?: boolean }): void {
  console.log(`${project.id}  ${project.name}`)
  console.log(`  workDir: ${project.workDir}`)
  if (project.goal) console.log(`  goal: ${project.goal}`)
  if (project.description) console.log(`  description: ${project.description}`)
  if (project.domainId) console.log(`  domainId: ${project.domainId}`)
  console.log(`  pinned: ${project.pinned ? 'yes' : 'no'}  archived: ${project.archived ? 'yes' : 'no'}`)
}

function printProjectOverview(overview: ProjectOverview): void {
  printProject(overview.project)
  console.log(`  counts: sessions=${overview.counts.sessions} tasks=${overview.counts.tasks} todos=${overview.counts.todos}`)
  console.log(`  waiting todos: ${overview.waitingTodos.length}`)
  if (overview.schedule) {
    console.log(`  schedule: last=${overview.schedule.lastRunAt ?? 'n/a'} next=${overview.schedule.nextRunAt ?? 'n/a'}`)
  } else {
    console.log('  schedule: n/a')
  }
  if (overview.recentActivity.length === 0) {
    console.log('  recent activity: (none)')
    return
  }
  console.log('  recent activity:')
  for (const item of overview.recentActivity.slice(0, 8)) {
    console.log(`    - ${item.createdAt}  ${item.subjectType}  ${item.op}  ${item.title}`)
    if (item.note) {
      console.log(`      ${item.note}`)
    }
  }
}

export const projectCommand = new Command('project')
projectCommand.description('Manage Pluse projects')

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
  .command('overview <id>')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    const overview: ProjectOverview | null = baseUrl
      ? await daemonRequest<ProjectOverview>(baseUrl, `/api/projects/${id}/overview`)
      : getProjectOverview(id)
    if (!overview) throw new Error(`Project not found: ${id}`)
    opts.json ? printJson(overview) : printProjectOverview(overview)
  })

projectCommand
  .command('open')
  .requiredOption('--work-dir <path>', 'Absolute work directory')
  .option('--name <name>', 'Project name')
  .option('--goal <goal>', 'Project goal')
  .option('--description <description>', 'Project description (for Agent context)')
  .option('--system-prompt <prompt>', 'Project system prompt')
  .option('--domain-id <id>', 'Assign project to a domain')
  .option('--pin', 'Pin the project', false)
  .option('--json', 'Output as JSON', false)
  .action(async (opts: { workDir: string; name?: string; goal?: string; description?: string; systemPrompt?: string; domainId?: string; pin: boolean; json: boolean }) => {
    const mode = getCliMode()
    const input: OpenProjectInput = {
      workDir: opts.workDir,
      name: opts.name,
      goal: opts.goal,
      description: opts.description,
      systemPrompt: opts.systemPrompt,
      domainId: opts.domainId,
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
  .option('--description <description>', 'New project description (for Agent context)')
  .option('--clear-description', 'Remove project description')
  .option('--system-prompt <prompt>', 'New project system prompt')
  .option('--domain-id <id>', 'Assign project to a domain')
  .option('--clear-domain', 'Remove project from its domain')
  .option('--pin', 'Pin the project')
  .option('--unpin', 'Unpin the project')
  .option('--archive', 'Archive the project')
  .option('--json', 'Output as JSON', false)
  .action(async (
    id: string,
    opts: { name?: string; goal?: string; description?: string; clearDescription?: boolean; systemPrompt?: string; domainId?: string; clearDomain?: boolean; pin?: boolean; unpin?: boolean; archive?: boolean; json: boolean },
  ) => {
    const patch: UpdateProjectInput = {
      name: opts.name,
      goal: opts.goal,
      description: opts.clearDescription ? null : opts.description,
      systemPrompt: opts.systemPrompt,
      domainId: opts.clearDomain ? null : opts.domainId,
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

projectCommand
  .command('delete <id>')
  .option('--confirm', 'Skip confirmation prompt', false)
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { confirm: boolean; json: boolean }) => {
    if (!opts.confirm) {
      console.error('Add --confirm to archive this project and all its data.')
      process.exit(1)
    }
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    if (baseUrl) {
      await daemonRequest(baseUrl, `/api/projects/${id}`, { method: 'DELETE' })
    } else {
      deleteProjectWithCascade(id)
    }
    opts.json ? console.log(JSON.stringify({ archived: true })) : console.log(`Project ${id} archived.`)
  })
