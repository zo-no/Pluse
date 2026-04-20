import { randomBytes } from 'node:crypto'
import type { CreateDomainInput, Domain, UpdateDomainInput } from '@pluse/types'
import { getDb } from '../db'

function genId(): string {
  return 'dom_' + randomBytes(8).toString('hex')
}

function now(): string {
  return new Date().toISOString()
}

type DomainRow = {
  id: string
  name: string
  description: string | null
  icon: string | null
  color: string | null
  order_index: number
  deleted: number
  deleted_at: string | null
  created_at: string
  updated_at: string
}

function rowToDomain(row: DomainRow): Domain {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    icon: row.icon ?? undefined,
    color: row.color ?? undefined,
    orderIndex: row.order_index,
    deleted: row.deleted === 1 ? true : undefined,
    deletedAt: row.deleted_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface ListDomainsOptions {
  includeDeleted?: boolean
}

export function listDomains(options: ListDomainsOptions = {}): Domain[] {
  const db = getDb()
  const conditions: string[] = []
  const params: Array<string | number> = []

  if (!options.includeDeleted) {
    conditions.push('deleted = 0')
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = db.query<DomainRow, Array<string | number>>(
    `SELECT * FROM domains ${where} ORDER BY deleted ASC, order_index ASC, updated_at DESC`
  ).all(...params)
  return rows.map(rowToDomain)
}

export function getDomain(id: string, options: ListDomainsOptions = {}): Domain | null {
  const db = getDb()
  const row = db.query<DomainRow, [string]>(
    `SELECT * FROM domains WHERE id = ?${options.includeDeleted ? '' : ' AND deleted = 0'} LIMIT 1`
  ).get(id)
  return row ? rowToDomain(row) : null
}

export function createDomainRecord(
  input: CreateDomainInput & {
    id?: string
    deleted?: boolean
    deletedAt?: string
    createdAt?: string
    updatedAt?: string
  },
): Domain {
  const db = getDb()
  const id = input.id ?? genId()
  const ts = input.createdAt ?? now()
  const updatedAt = input.updatedAt ?? ts

  db.run(
    `INSERT INTO domains (
      id, name, description, icon, color, order_index, deleted, deleted_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.description ?? null,
      input.icon ?? null,
      input.color ?? null,
      input.orderIndex ?? 0,
      input.deleted ? 1 : 0,
      input.deleted ? (input.deletedAt ?? ts) : null,
      ts,
      updatedAt,
    ],
  )

  return getDomain(id, { includeDeleted: true })!
}

export function updateDomainRecord(id: string, input: UpdateDomainInput): Domain {
  const db = getDb()
  const existing = getDomain(id, { includeDeleted: true })
  if (!existing) throw new Error(`Domain not found: ${id}`)

  const ts = now()
  const sets: string[] = ['updated_at = ?']
  const params: Array<string | number | null> = [ts]

  if ('name' in input && input.name !== undefined) {
    sets.push('name = ?')
    params.push(input.name)
  }
  if ('description' in input) {
    sets.push('description = ?')
    params.push(input.description ?? null)
  }
  if ('icon' in input) {
    sets.push('icon = ?')
    params.push(input.icon ?? null)
  }
  if ('color' in input) {
    sets.push('color = ?')
    params.push(input.color ?? null)
  }
  if ('orderIndex' in input && input.orderIndex !== undefined) {
    sets.push('order_index = ?')
    params.push(input.orderIndex ?? 0)
  }

  params.push(id)
  db.run(`UPDATE domains SET ${sets.join(', ')} WHERE id = ?`, params)
  return getDomain(id, { includeDeleted: true })!
}

export function deleteDomainRecord(id: string): Domain {
  const db = getDb()
  const existing = getDomain(id, { includeDeleted: true })
  if (!existing) throw new Error(`Domain not found: ${id}`)

  const ts = now()
  db.run(
    `UPDATE domains
       SET deleted = 1,
           deleted_at = COALESCE(deleted_at, ?),
           updated_at = ?
     WHERE id = ?`,
    [ts, ts, id],
  )

  return getDomain(id, { includeDeleted: true })!
}
