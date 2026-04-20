import { beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import type { ApiResult, Domain, Project } from '@pluse/types'
import { stopScheduler } from '../services/scheduler'
import { DEL, GET, PATCH, POST, makeWorkDir, resetTestDb, setupTestDb } from './helpers'

function mustOk<T>(response: { json: ApiResult<T> }): T {
  expect(response.json.ok).toBe(true)
  if (!response.json.ok) {
    throw new Error(response.json.error)
  }
  return response.json.data
}

beforeAll(() => setupTestDb())

beforeEach(() => {
  stopScheduler()
  resetTestDb()
})

describe('domain APIs', () => {
  it('creates, updates, templates, and clears project ownership when archived', async () => {
    const created = await POST<Domain>('/api/domains', {
      name: '产品/事业',
      description: 'Core work',
    })
    expect(created.status).toBe(201)
    const createdDomain = mustOk(created)
    expect(createdDomain.name).toBe('产品/事业')

    const updated = await PATCH<Domain>(`/api/domains/${createdDomain.id}`, {
      name: '事业',
      description: 'Primary work',
    })
    expect(updated.status).toBe(200)
    const updatedDomain = mustOk(updated)
    expect(updatedDomain.name).toBe('事业')
    expect(updatedDomain.description).toBe('Primary work')

    const firstDefaults = await POST<Domain[]>('/api/domains/defaults')
    expect(firstDefaults.status).toBe(201)
    const firstDefaultsData = mustOk(firstDefaults)
    expect(firstDefaultsData.some((domain) => domain.name === '财富')).toBe(true)
    expect(firstDefaultsData.some((domain) => domain.name === '事业')).toBe(false)

    const secondDefaults = await POST<Domain[]>('/api/domains/defaults')
    expect(secondDefaults.status).toBe(201)
    expect(mustOk(secondDefaults)).toHaveLength(0)

    const workDir = makeWorkDir('domain-project')
    const projectCreate = await POST<Project>('/api/projects/open', {
      workDir,
      name: 'Domain Project',
      domainId: updatedDomain.id,
    })
    expect(projectCreate.status).toBe(201)
    expect(mustOk(projectCreate).domainId).toBe(updatedDomain.id)

    const projectReopen = await POST<Project>('/api/projects/open', {
      workDir,
      name: 'Domain Project Reloaded',
    })
    expect(projectReopen.status).toBe(201)
    expect(mustOk(projectReopen).domainId).toBe(updatedDomain.id)

    const invalidAssign = await PATCH<Project>(`/api/projects/${mustOk(projectCreate).id}`, {
      domainId: 'dom_missing',
    })
    expect(invalidAssign.status).toBe(400)
    expect(invalidAssign.json.ok).toBe(false)

    const deleted = await DEL<{ deleted: boolean }>(`/api/domains/${updatedDomain.id}`)
    expect(deleted.status).toBe(200)
    expect(mustOk(deleted).deleted).toBe(true)

    const projectAfterDelete = await GET<Project>(`/api/projects/${mustOk(projectCreate).id}`)
    expect(projectAfterDelete.status).toBe(200)
    expect(mustOk(projectAfterDelete).domainId).toBeUndefined()

    const activeDomains = await GET<Domain[]>('/api/domains')
    expect(activeDomains.status).toBe(200)
    expect(mustOk(activeDomains).some((domain) => domain.id === updatedDomain.id)).toBe(false)
  })
})
