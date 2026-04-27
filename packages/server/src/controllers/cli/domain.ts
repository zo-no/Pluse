import { Command } from 'commander'
import type { CreateDomainInput, Domain, Project, UpdateDomainInput } from '@pluse/types'
import { listDomains } from '../../models/domain'
import { createDefaultDomainsWithEffects, createDomainWithEffects, deleteDomainWithEffects, updateDomainWithEffects } from '../../services/domains'
import { listVisibleProjects } from '../../services/projects'
import type { DomainWithProjects } from '../http/domains'
import { daemonRequest, getCliMode, resolveDaemonBaseUrl } from '../../support/cli-runtime'

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function printDomain(domain: Domain): void {
  console.log(`${domain.id}  ${domain.name}`)
  if (domain.description) console.log(`  description: ${domain.description}`)
  if (domain.icon) console.log(`  icon: ${domain.icon}`)
  if (domain.color) console.log(`  color: ${domain.color}`)
  console.log(`  orderIndex: ${domain.orderIndex}`)
}

function printProject(project: Project): void {
  console.log(`    ${project.id}  ${project.name}`)
  console.log(`      priority: ${project.priority}`)
  console.log(`      workDir: ${project.workDir}`)
  if (project.goal) console.log(`      goal: ${project.goal}`)
  if (project.description) console.log(`      description: ${project.description}`)
}

function printDomainWithProjects(entry: DomainWithProjects): void {
  console.log(`${entry.id ?? '(ungrouped)'}  ${entry.name}`)
  if (entry.description) console.log(`  description: ${entry.description}`)
  console.log(`  projects:`)
  if (entry.projects.length === 0) {
    console.log(`    (empty)`)
  } else {
    entry.projects.forEach(printProject)
  }
}

function buildDomainWithProjects(): DomainWithProjects[] {
  const domains = listDomains()
  const projects = listVisibleProjects()
  const byDomainId = new Map<string, Project[]>()
  const ungrouped: Project[] = []
  for (const p of projects) {
    if (p.domainId) {
      const arr = byDomainId.get(p.domainId) ?? []
      arr.push(p)
      byDomainId.set(p.domainId, arr)
    } else {
      ungrouped.push(p)
    }
  }
  return [
    ...domains.map((d) => ({ ...d, projects: byDomainId.get(d.id) ?? [] })),
    { id: null as unknown as string, name: '未分组', description: undefined, icon: undefined, color: undefined, orderIndex: 9999, deleted: false, deletedAt: undefined, createdAt: '', updatedAt: '', projects: ungrouped },
  ]
}

export const domainCommand = new Command('domain')
domainCommand.description('Manage Domains')

domainCommand
  .command('list')
  .option('--with-projects', 'Include projects under each domain', false)
  .option('--json', 'Output as JSON', false)
  .action(async (opts: { withProjects: boolean; json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    if (opts.withProjects) {
      const entries: DomainWithProjects[] = baseUrl
        ? await daemonRequest<DomainWithProjects[]>(baseUrl, '/api/domains?withProjects=true')
        : buildDomainWithProjects()
      opts.json ? printJson(entries) : entries.forEach(printDomainWithProjects)
      return
    }
    const domains = baseUrl
      ? await daemonRequest<Domain[]>(baseUrl, '/api/domains')
      : listDomains()
    opts.json ? printJson(domains) : domains.forEach(printDomain)
  })

domainCommand
  .command('defaults')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: { json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const created: Domain[] = baseUrl
      ? await daemonRequest<Domain[]>(baseUrl, '/api/domains/defaults', { method: 'POST' })
      : createDefaultDomainsWithEffects()
    opts.json ? printJson(created) : created.forEach(printDomain)
  })

domainCommand
  .command('create')
  .requiredOption('--name <name>', 'Domain name')
  .option('--description <description>', 'Description')
  .option('--icon <icon>', 'Icon')
  .option('--color <color>', 'Color')
  .option('--order-index <n>', 'Display order index', (value) => Number.parseInt(value, 10))
  .option('--json', 'Output as JSON', false)
  .action(async (opts: { name: string; description?: string; icon?: string; color?: string; orderIndex?: number; json: boolean }) => {
    const input: CreateDomainInput = {
      name: opts.name,
      description: opts.description,
      icon: opts.icon,
      color: opts.color,
      orderIndex: Number.isFinite(opts.orderIndex as number) ? opts.orderIndex : undefined,
    }
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const domain: Domain = baseUrl
      ? await daemonRequest<Domain>(baseUrl, '/api/domains', { method: 'POST', body: JSON.stringify(input) })
      : createDomainWithEffects(input)
    opts.json ? printJson(domain) : printDomain(domain)
  })

domainCommand
  .command('update <id>')
  .option('--name <name>', 'Domain name')
  .option('--description <description>', 'Description')
  .option('--icon <icon>', 'Icon')
  .option('--color <color>', 'Color')
  .option('--order-index <n>', 'Display order index', (value) => Number.parseInt(value, 10))
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { name?: string; description?: string; icon?: string; color?: string; orderIndex?: number; json: boolean }) => {
    const patch: UpdateDomainInput = {
      name: opts.name,
      description: opts.description,
      icon: opts.icon,
      color: opts.color,
      orderIndex: Number.isFinite(opts.orderIndex as number) ? opts.orderIndex : undefined,
    }
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const domain: Domain = baseUrl
      ? await daemonRequest<Domain>(baseUrl, `/api/domains/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      : updateDomainWithEffects(id, patch)
    opts.json ? printJson(domain) : printDomain(domain)
  })

domainCommand
  .command('delete <id>')
  .option('--confirm', 'Skip confirmation prompt', false)
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { confirm: boolean; json: boolean }) => {
    if (!opts.confirm) {
      console.error('Add --confirm to archive this domain.')
      process.exit(1)
    }
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    if (baseUrl) {
      await daemonRequest(baseUrl, `/api/domains/${id}`, { method: 'DELETE' })
    } else {
      deleteDomainWithEffects(id)
    }
    opts.json ? printJson({ deleted: true }) : console.log(`Domain ${id} archived.`)
  })
