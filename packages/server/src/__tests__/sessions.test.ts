import { beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import type { PagedResult, Project, Session, SessionEvent } from '@melody-sync/types'
import { GET, PATCH, POST, makeWorkDir, resetTestDb, setupTestDb } from './helpers'

beforeAll(() => setupTestDb())
beforeEach(() => resetTestDb())

async function createProject(): Promise<Project> {
  const result = await POST<Project>('/api/projects/open', {
    workDir: makeWorkDir('session-project'),
    name: 'Session Project',
  })
  expect(result.json.ok).toBe(true)
  if (!result.json.ok) throw new Error(result.json.error)
  return result.json.data
}

describe('session HTTP routes', () => {
  it('creates, lists, updates and archives sessions by project', async () => {
    const project = await createProject()

    const created = await POST<Session>('/api/sessions', {
      projectId: project.id,
      name: 'Planning',
      tool: 'codex',
      model: 'gpt-5.4',
      effort: 'medium',
      thinking: true,
    })
    expect(created.status).toBe(201)
    expect(created.json.ok).toBe(true)
    if (!created.json.ok) return

    const sessionId = created.json.data.id
    expect(created.json.data.projectId).toBe(project.id)

    const list = await GET<Session[]>(`/api/sessions?projectId=${project.id}`)
    expect(list.json.ok).toBe(true)
    if (!list.json.ok) return
    expect(list.json.data).toHaveLength(1)

    const patched = await PATCH<Session>(`/api/sessions/${sessionId}`, {
      name: 'Planning Renamed',
      pinned: true,
      archived: true,
    })
    expect(patched.json.ok).toBe(true)
    if (!patched.json.ok) return
    expect(patched.json.data.archived).toBe(true)

    const active = await GET<Session[]>(`/api/sessions?projectId=${project.id}`)
    expect(active.json.ok).toBe(true)
    if (!active.json.ok) return
    expect(active.json.data).toHaveLength(0)

    const archived = await GET<Session[]>(`/api/sessions?projectId=${project.id}&archived=true`)
    expect(archived.json.ok).toBe(true)
    if (!archived.json.ok) return
    expect(archived.json.data).toHaveLength(1)
  })

  it('returns event pagination shape for a new session', async () => {
    const project = await createProject()
    const created = await POST<Session>('/api/sessions', {
      projectId: project.id,
      name: 'Empty Events',
    })
    expect(created.json.ok).toBe(true)
    if (!created.json.ok) return

    const events = await GET<PagedResult<SessionEvent>>(`/api/sessions/${created.json.data.id}/events`)
    expect(events.status).toBe(200)
    expect(events.json.ok).toBe(true)
    if (!events.json.ok) return
    expect(events.json.data.items).toEqual([])
    expect(events.json.data.total).toBe(0)
  })
})
