import { beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import type { Project, Session, Task } from '@melody-sync/types'
import { DEL, GET, POST, makeWorkDir, resetTestDb, setupTestDb } from './helpers'

beforeAll(() => setupTestDb())
beforeEach(() => resetTestDb())

async function setupFullProject(): Promise<{ project: Project; session: Session; task: Task }> {
  const p = await POST<Project>('/api/projects/open', {
    workDir: makeWorkDir('delete-project'),
    name: 'Delete Me',
  })
  expect(p.json.ok).toBe(true)
  if (!p.json.ok) throw new Error(p.json.error)

  const s = await POST<Session>('/api/sessions', { projectId: p.json.data.id, name: 'Session' })
  expect(s.json.ok).toBe(true)
  if (!s.json.ok) throw new Error(s.json.error)

  const t = await POST<Task>('/api/tasks', {
    projectId: p.json.data.id,
    title: 'Task',
    assignee: 'human',
    kind: 'once',
    createdBy: 'human',
  })
  expect(t.json.ok).toBe(true)
  if (!t.json.ok) throw new Error(t.json.error)

  return { project: p.json.data, session: s.json.data, task: t.json.data }
}

describe('DELETE /api/projects/:id', () => {
  it('deletes project and cascades to sessions and tasks', async () => {
    const { project, session, task } = await setupFullProject()

    const result = await DEL(`/api/projects/${project.id}`)
    expect(result.status).toBe(200)
    expect(result.json.ok).toBe(true)

    // project gone
    const fetched = await GET<Project>(`/api/projects/${project.id}`)
    expect(fetched.status).toBe(404)

    // session gone
    const sess = await GET<Session>(`/api/sessions/${session.id}`)
    expect(sess.status).toBe(404)

    // task gone
    const tsk = await GET<Task>(`/api/tasks/${task.id}`)
    expect(tsk.status).toBe(404)
  })

  it('returns 404 for unknown project', async () => {
    const result = await DEL('/api/projects/proj_unknown')
    expect(result.status).toBe(404)
  })

  it('does not affect other projects', async () => {
    const { project } = await setupFullProject()
    const other = await POST<Project>('/api/projects/open', {
      workDir: makeWorkDir('other-project'),
      name: 'Other',
    })
    expect(other.json.ok).toBe(true)
    if (!other.json.ok) return

    await DEL(`/api/projects/${project.id}`)

    const fetched = await GET<Project>(`/api/projects/${other.json.data.id}`)
    expect(fetched.status).toBe(200)
    expect(fetched.json.ok).toBe(true)
  })
})

describe('GET /api/tasks/:id/runs, /logs, /ops', () => {
  it('returns empty arrays for a new task', async () => {
    const p = await POST<Project>('/api/projects/open', { workDir: makeWorkDir('task-detail'), name: 'P' })
    expect(p.json.ok).toBe(true)
    if (!p.json.ok) return

    const t = await POST<Task>('/api/tasks', {
      projectId: p.json.data.id, title: 'T', assignee: 'ai', kind: 'once', createdBy: 'ai',
    })
    expect(t.json.ok).toBe(true)
    if (!t.json.ok) return

    const runs = await GET(`/api/tasks/${t.json.data.id}/runs`)
    expect(runs.status).toBe(200)
    expect(runs.json.ok).toBe(true)
    if (!runs.json.ok) return
    expect(Array.isArray(runs.json.data)).toBe(true)

    const logs = await GET(`/api/tasks/${t.json.data.id}/logs`)
    expect(logs.status).toBe(200)
    expect(logs.json.ok).toBe(true)

    const ops = await GET(`/api/tasks/${t.json.data.id}/ops`)
    expect(ops.status).toBe(200)
    expect(ops.json.ok).toBe(true)
  })
})
