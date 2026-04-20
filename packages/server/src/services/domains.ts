import type { CreateDomainInput, Domain, UpdateDomainInput } from '@pluse/types'
import { getDb } from '../db'
import { createDomainRecord, getDomain, listDomains, updateDomainRecord } from '../models/domain'
import { emit } from './events'

function now(): string {
  return new Date().toISOString()
}

function emitDomainUpdated(domain: Domain): void {
  emit({
    type: 'domain_updated',
    data: { domainId: domain.id },
  })
}

function emitProjectUpdated(projectId: string): void {
  emit({
    type: 'project_updated',
    data: { projectId },
  })
}

function assertName(input: string): string {
  const name = input.trim()
  if (!name) throw new Error('Domain name is required')
  return name
}

export const DEFAULT_DOMAIN_TEMPLATES: Array<Pick<CreateDomainInput, 'name' | 'description' | 'orderIndex'>> = [
  { name: '产品/事业', description: '产品、事业、增长与主线业务。', orderIndex: 0 },
  { name: '财富', description: '收入、现金流、资产与投资。', orderIndex: 1 },
  { name: '能力', description: '技能、学习、输入与输出。', orderIndex: 2 },
  { name: '影响力', description: '公开表达、内容、品牌与传播。', orderIndex: 3 },
  { name: '关系', description: '家人、伴侣、朋友与合作关系。', orderIndex: 4 },
  { name: '健康', description: '身体、精力、作息与恢复。', orderIndex: 5 },
  { name: '运营', description: '系统维护、复盘与日常运转。', orderIndex: 6 },
]

export function listDomainViews(filter: Parameters<typeof listDomains>[0] = {}): Domain[] {
  return listDomains(filter)
}

export function createDomainWithEffects(input: CreateDomainInput): Domain {
  const domain = createDomainRecord({
    ...input,
    name: assertName(input.name),
  })
  emitDomainUpdated(domain)
  return domain
}

export function createDefaultDomainsWithEffects(): Domain[] {
  const existingNames = new Set(
    listDomains()
      .map((domain) => domain.name.trim())
      .filter(Boolean),
  )

  const created: Domain[] = []
  for (const template of DEFAULT_DOMAIN_TEMPLATES) {
    const name = template.name.trim()
    if (!name || existingNames.has(name)) continue
    const domain = createDomainRecord({
      ...template,
      name,
    })
    existingNames.add(name)
    created.push(domain)
  }

  for (const domain of created) {
    emitDomainUpdated(domain)
  }

  return created
}

export function updateDomainWithEffects(id: string, input: UpdateDomainInput): Domain {
  const before = getDomain(id, { includeDeleted: true })
  if (!before || before.deleted) throw new Error(`Domain not found: ${id}`)
  const nextInput: UpdateDomainInput = {
    ...input,
    name: input.name !== undefined ? assertName(input.name) : input.name,
  }
  const domain = updateDomainRecord(id, nextInput)
  emitDomainUpdated(domain)
  return domain
}

export function deleteDomainWithEffects(id: string): Domain {
  const before = getDomain(id, { includeDeleted: true })
  if (!before || before.deleted) throw new Error(`Domain not found: ${id}`)

  const db = getDb()
  const ts = now()
  const projectIds = db.query<{ id: string }, [string]>(
    'SELECT id FROM projects WHERE domain_id = ?'
  ).all(id).map((row) => row.id)

  const tx = db.transaction(() => {
    db.run(
      `UPDATE domains
         SET deleted = 1,
             deleted_at = COALESCE(deleted_at, ?),
             updated_at = ?
       WHERE id = ?`,
      [ts, ts, id],
    )
    db.run(
      `UPDATE projects
         SET domain_id = NULL,
             updated_at = ?
       WHERE domain_id = ?`,
      [ts, id],
    )
  })
  tx()

  for (const projectId of projectIds) {
    emitProjectUpdated(projectId)
  }

  const deleted = getDomain(id, { includeDeleted: true })
  if (!deleted) throw new Error(`Domain not found: ${id}`)
  emit({
    type: 'domain_deleted',
    data: { domainId: deleted.id },
  })
  return deleted
}
