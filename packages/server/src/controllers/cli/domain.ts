import { Command } from 'commander'
import type { CreateDomainInput, Domain, UpdateDomainInput } from '@pluse/types'
import { listDomains } from '../../models/domain'
import { createDefaultDomainsWithEffects, createDomainWithEffects, deleteDomainWithEffects, updateDomainWithEffects } from '../../services/domains'
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

export const domainCommand = new Command('domain')
domainCommand.description('Manage Domains')

domainCommand
  .command('list')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: { json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
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
