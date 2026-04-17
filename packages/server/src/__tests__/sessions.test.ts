import { beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import type { Project, Session, Task } from '@pluse/types'
import { GET, PATCH, POST, DEL, makeWorkDir, resetTestDb, setupTestDb } from './helpers'
import { enqueueFollowUp, getFollowUpQueue, getSession, listSessionsWithPendingQueue } from '../models/session'
import { recoverFollowUpQueues } from '../runtime/session-runner'

beforeAll(() => setupTestDb())
beforeEach(() => resetTestDb())

async function setupProject(): Promise<Project> {
  const result = await POST<Project>('/api/projects/open', {
    workDir: makeWorkDir('session-project'),
    name: 'Session Project',
  })
  expect(result.json.ok).toBe(true)
  if (!result.json.ok) throw new Error(result.json.error)
  return result.json.data
}

describe('session CRUD', () => {
  it('creates a session with createdBy and followUpQueue', async () => {
    const project = await setupProject()

    const result = await POST<Session>('/api/sessions', {
      projectId: project.id,
      name: 'My Session',
    })
    expect(result.status).toBe(201)
    expect(result.json.ok).toBe(true)
    if (!result.json.ok) return

    const session = result.json.data
    expect(session.projectId).toBe(project.id)
    expect(session.createdBy).toBe('human')
    expect(session.autoRenamePending).toBe(true)
    expect(Array.isArray(session.followUpQueue)).toBe(true)
    expect(session.followUpQueue).toHaveLength(0)
  })

  it('lists sessions by project', async () => {
    const project = await setupProject()
    await POST('/api/sessions', { projectId: project.id, name: 'S1' })
    await POST('/api/sessions', { projectId: project.id, name: 'S2' })

    const result = await GET<Session[]>(`/api/sessions?projectId=${project.id}`)
    expect(result.json.ok).toBe(true)
    if (!result.json.ok) return
    expect(result.json.data).toHaveLength(2)
  })

  it('updates session name', async () => {
    const project = await setupProject()
    const created = await POST<Session>('/api/sessions', { projectId: project.id, name: 'Old Name' })
    expect(created.json.ok).toBe(true)
    if (!created.json.ok) return

    const updated = await PATCH<Session>(`/api/sessions/${created.json.data.id}`, { name: 'New Name' })
    expect(updated.json.ok).toBe(true)
    if (!updated.json.ok) return
    expect(updated.json.data.name).toBe('New Name')
  })

  it('archives a session', async () => {
    const project = await setupProject()
    const created = await POST<Session>('/api/sessions', { projectId: project.id, name: 'To Archive' })
    expect(created.json.ok).toBe(true)
    if (!created.json.ok) return

    const archived = await PATCH<Session>(`/api/sessions/${created.json.data.id}`, { archived: true })
    expect(archived.json.ok).toBe(true)
    if (!archived.json.ok) return
    expect(archived.json.data.archived).toBe(true)
    expect(archived.json.data.archivedAt).toBeTruthy()

    const list = await GET<Session[]>(`/api/sessions?projectId=${project.id}`)
    expect(list.json.ok).toBe(true)
    if (!list.json.ok) return
    const createdId = created.json.ok ? created.json.data.id : ''
    expect(list.json.data.every((s) => s.id !== createdId)).toBe(true)
  })
})

describe('session create-task', () => {
  it('creates an AI task linked to the session', async () => {
    const project = await setupProject()
    const sess = await POST<Session>('/api/sessions', { projectId: project.id, name: 'Work Session' })
    expect(sess.json.ok).toBe(true)
    if (!sess.json.ok) return

    const result = await POST<Task>(`/api/sessions/${sess.json.data.id}/create-task`, {
      title: 'Implement feature X',
      assignee: 'ai',
    })
    expect(result.status).toBe(201)
    expect(result.json.ok).toBe(true)
    if (!result.json.ok) return

    const task = result.json.data
    expect(task.originSessionId).toBe(sess.json.data.id)
    expect(task.sessionId).toBe(sess.json.data.id)
    expect(task.projectId).toBe(project.id)
    expect(task.assignee).toBe('ai')
    expect(task.createdBy).toBe('human')
  })

  it('creates a human task with waitingInstructions', async () => {
    const project = await setupProject()
    const sess = await POST<Session>('/api/sessions', { projectId: project.id, name: 'Work Session' })
    expect(sess.json.ok).toBe(true)
    if (!sess.json.ok) return

    const result = await POST<Task>(`/api/sessions/${sess.json.data.id}/create-task`, {
      title: 'Review the output',
      assignee: 'human',
      waitingInstructions: 'Check the generated report',
    })
    expect(result.status).toBe(201)
    expect(result.json.ok).toBe(true)
    if (!result.json.ok) return
    expect(result.json.data.waitingInstructions).toBe('Check the generated report')
  })

  it('returns 404 for unknown session', async () => {
    const result = await POST('/api/sessions/sess_unknown/create-task', {
      title: 'Test', assignee: 'ai',
    })
    expect(result.status).toBe(404)
  })
})

describe('followUpQueue', () => {
  it('enqueue persists to DB and is idempotent', async () => {
    const project = await setupProject()
    const sess = await POST<Session>('/api/sessions', { projectId: project.id, name: 'Q Session' })
    expect(sess.json.ok).toBe(true)
    if (!sess.json.ok) return
    const sessionId = sess.json.data.id

    expect(getFollowUpQueue(sessionId)).toHaveLength(0)

    enqueueFollowUp(sessionId, { requestId: 'req_001', text: 'hello', tool: 'codex', model: null, effort: null, thinking: false })
    expect(getFollowUpQueue(sessionId)).toHaveLength(1)

    // same requestId — not added twice
    enqueueFollowUp(sessionId, { requestId: 'req_001', text: 'hello', tool: 'codex', model: null, effort: null, thinking: false })
    expect(getFollowUpQueue(sessionId)).toHaveLength(1)

    enqueueFollowUp(sessionId, { requestId: 'req_002', text: 'second', tool: 'codex', model: null, effort: null, thinking: false })
    expect(getFollowUpQueue(sessionId)).toHaveLength(2)

    // session.followUpQueue reflects DB state
    const fetched = getSession(sessionId)!
    expect(fetched.followUpQueue).toHaveLength(2)
    expect(fetched.followUpQueue[0]!.requestId).toBe('req_001')
  })

  it('listSessionsWithPendingQueue returns only sessions with non-empty queue and no active run', async () => {
    const project = await setupProject()
    const s1 = await POST<Session>('/api/sessions', { projectId: project.id, name: 'S1' })
    const s2 = await POST<Session>('/api/sessions', { projectId: project.id, name: 'S2' })
    expect(s1.json.ok && s2.json.ok).toBe(true)
    if (!s1.json.ok || !s2.json.ok) return

    enqueueFollowUp(s1.json.data.id, { requestId: 'req_x', text: 'msg', tool: 'codex', model: null, effort: null, thinking: false })

    const pending = listSessionsWithPendingQueue()
    const ids = pending.map((s) => s.id)
    expect(ids).toContain(s1.json.data.id)
    expect(ids).not.toContain(s2.json.data.id)
  })
})

describe('recoverFollowUpQueues', () => {
  it('does not throw when no sessions have pending queues', () => {
    expect(() => recoverFollowUpQueues()).not.toThrow()
  })

  it('dequeues the item during recovery attempt', async () => {
    const project = await setupProject()
    const sess = await POST<Session>('/api/sessions', { projectId: project.id, name: 'Recovery Session' })
    expect(sess.json.ok).toBe(true)
    if (!sess.json.ok) return
    const sessionId = sess.json.data.id

    enqueueFollowUp(sessionId, { requestId: 'req_recover', text: 'recover this', tool: 'codex', model: null, effort: null, thinking: false })
    expect(getFollowUpQueue(sessionId)).toHaveLength(1)

    // recovery dequeues the item (run will fail silently — no real AI process in tests)
    recoverFollowUpQueues()

    expect(getFollowUpQueue(sessionId)).toHaveLength(0)
  })
})

describe('autoRenamePending', () => {
  it('new session has autoRenamePending=true', async () => {
    const project = await setupProject()
    const result = await POST<Session>('/api/sessions', { projectId: project.id, name: 'Unnamed' })
    expect(result.json.ok).toBe(true)
    if (!result.json.ok) return
    expect(result.json.data.autoRenamePending).toBe(true)
  })

  it('can be cleared via PATCH', async () => {
    const project = await setupProject()
    const created = await POST<Session>('/api/sessions', { projectId: project.id, name: 'Unnamed' })
    expect(created.json.ok).toBe(true)
    if (!created.json.ok) return

    const updated = await PATCH<Session>(`/api/sessions/${created.json.data.id}`, {
      name: 'Named Session',
      autoRenamePending: false,
    })
    expect(updated.json.ok).toBe(true)
    if (!updated.json.ok) return
    expect(updated.json.data.autoRenamePending).toBeUndefined()
    expect(updated.json.data.name).toBe('Named Session')
  })
})
