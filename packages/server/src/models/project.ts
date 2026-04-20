import { randomBytes } from 'node:crypto'
import type { CreateProjectInput, Project, ProjectVisibility, UpdateProjectInput } from '@pluse/types'
import { getDb } from '../db'

function genId(): string {
  return 'proj_' + randomBytes(8).toString('hex')
}

function now(): string {
  return new Date().toISOString()
}

type ProjectRow = {
  id: string
  name: string
  goal: string | null
  work_dir: string | null
  system_prompt: string | null
  domain_id: string | null
  archived: number
  pinned: number
  visibility: ProjectVisibility
  created_at: string
  updated_at: string
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    goal: row.goal ?? undefined,
    workDir: row.work_dir ?? '',
    systemPrompt: row.system_prompt ?? undefined,
    domainId: row.domain_id ?? undefined,
    archived: row.archived === 1,
    pinned: row.pinned === 1,
    visibility: row.visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface ListProjectsOptions {
  includeArchived?: boolean
  includeSystem?: boolean
}

export function listProjects(options: ListProjectsOptions = {}): Project[] {
  const db = getDb()
  const conditions: string[] = []
  const params: Array<string | number> = []

  if (!options.includeArchived) {
    conditions.push('archived = 0')
  }
  if (!options.includeSystem) {
    conditions.push("visibility = 'user'")
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = db.query<ProjectRow, Array<string | number>>(
    `SELECT * FROM projects ${where} ORDER BY pinned DESC, updated_at DESC`
  ).all(...params)
  return rows.map(rowToProject)
}

export function getProject(id: string): Project | null {
  const db = getDb()
  const row = db.query<ProjectRow, [string]>(
    'SELECT * FROM projects WHERE id = ?'
  ).get(id)
  return row ? rowToProject(row) : null
}

export function getProjectByWorkDir(workDir: string): Project | null {
  const db = getDb()
  const row = db.query<ProjectRow, [string]>(
    'SELECT * FROM projects WHERE work_dir = ? LIMIT 1'
  ).get(workDir)
  return row ? rowToProject(row) : null
}

export function createProjectRecord(
  input: CreateProjectInput & {
    id?: string
    visibility?: ProjectVisibility
    createdAt?: string
    updatedAt?: string
  }
): Project {
  const db = getDb()
  const id = input.id ?? genId()
  const ts = input.createdAt ?? now()
  const updatedAt = input.updatedAt ?? ts

  db.run(
    `INSERT INTO projects (
      id, name, goal, work_dir, system_prompt, domain_id, archived, pinned, visibility, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.goal ?? null,
      input.workDir,
      input.systemPrompt ?? null,
      input.domainId ?? null,
      input.pinned ? 1 : 0,
      input.visibility ?? 'user',
      ts,
      updatedAt,
    ],
  )

  return getProject(id)!
}

export function upsertProjectRecord(project: Project): Project {
  const db = getDb()
  db.run(
    `INSERT INTO projects (
      id, name, goal, work_dir, system_prompt, domain_id, archived, pinned, visibility, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      goal = excluded.goal,
      work_dir = excluded.work_dir,
      system_prompt = excluded.system_prompt,
      domain_id = excluded.domain_id,
      archived = excluded.archived,
      pinned = excluded.pinned,
      visibility = excluded.visibility,
      updated_at = excluded.updated_at`,
    [
      project.id,
      project.name,
      project.goal ?? null,
      project.workDir,
      project.systemPrompt ?? null,
      project.domainId ?? null,
      project.archived ? 1 : 0,
      project.pinned ? 1 : 0,
      project.visibility,
      project.createdAt,
      project.updatedAt,
    ],
  )
  return getProject(project.id)!
}

export function updateProject(id: string, input: UpdateProjectInput & { workDir?: string }): Project {
  const db = getDb()
  const existing = getProject(id)
  if (!existing) throw new Error(`Project not found: ${id}`)

  const ts = now()
  const sets: string[] = ['updated_at = ?']
  const params: Array<string | number | null> = [ts]

  if ('name' in input && input.name !== undefined) {
    sets.push('name = ?')
    params.push(input.name)
  }
  if ('goal' in input) {
    sets.push('goal = ?')
    params.push(input.goal ?? null)
  }
  if ('workDir' in input && input.workDir !== undefined) {
    sets.push('work_dir = ?')
    params.push(input.workDir)
  }
  if ('systemPrompt' in input) {
    sets.push('system_prompt = ?')
    params.push(input.systemPrompt ?? null)
  }
  if ('domainId' in input && input.domainId !== undefined) {
    sets.push('domain_id = ?')
    params.push(input.domainId ?? null)
  }
  if ('pinned' in input && input.pinned !== undefined) {
    sets.push('pinned = ?')
    params.push(input.pinned ? 1 : 0)
  }
  if ('archived' in input && input.archived !== undefined) {
    sets.push('archived = ?')
    params.push(input.archived ? 1 : 0)
  }

  params.push(id)
  db.run(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`, params)
  return getProject(id)!
}

export function deleteProjectRecord(id: string): void {
  const db = getDb()
  db.run('DELETE FROM projects WHERE id = ?', [id])
}
