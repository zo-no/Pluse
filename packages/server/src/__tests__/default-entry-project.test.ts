import { beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { createDomainRecord } from '../models/domain'
import { createProjectRecord, getProject } from '../models/project'
import {
  DEFAULT_ENTRY_PROJECT_ID,
  DEFAULT_ENTRY_PROJECT_NAME,
  LEGACY_INBOX_PROJECT_ID,
  ensureBuiltinProjects,
  listVisibleProjects,
} from '../services/projects'
import { stopScheduler } from '../services/scheduler'
import { getDefaultEntryProjectDir } from '../support/paths'
import { makeWorkDir, resetTestDb, setupTestDb } from './helpers'

beforeAll(() => setupTestDb())

beforeEach(() => {
  stopScheduler()
  resetTestDb()
})

describe('default entry project', () => {
  it('creates self-dialogue as the first project for new users', () => {
    ensureBuiltinProjects()

    const projects = listVisibleProjects()
    expect(projects[0]?.id).toBe(DEFAULT_ENTRY_PROJECT_ID)
    expect(projects[0]?.name).toBe(DEFAULT_ENTRY_PROJECT_NAME)
    expect(projects[0]?.goal).toContain('挖掘真实需求')
    expect(projects[0]?.description).toContain('默认入口')
    expect(projects[0]?.workDir).toBe(getDefaultEntryProjectDir())
    expect(projects[0]?.domainId).toBeUndefined()
  })

  it('promotes an existing self-dialogue project over the legacy inbox', () => {
    const domain = createDomainRecord({
      name: '影响力',
      orderIndex: 3,
    })
    const legacy = createProjectRecord({
      id: LEGACY_INBOX_PROJECT_ID,
      name: 'Inbox',
      workDir: makeWorkDir('legacy-inbox'),
      goal: 'Old inbox',
      pinned: true,
    })
    const selfDialogue = createProjectRecord({
      name: DEFAULT_ENTRY_PROJECT_NAME,
      workDir: makeWorkDir('self-dialogue'),
      goal: 'Old self-dialogue goal',
      domainId: domain.id,
    })

    ensureBuiltinProjects()

    const updatedSelfDialogue = getProject(selfDialogue.id)
    expect(updatedSelfDialogue?.pinned).toBe(true)
    expect(updatedSelfDialogue?.goal).toContain('挖掘真实需求')
    expect(updatedSelfDialogue?.description).toContain('默认入口')
    expect(updatedSelfDialogue?.domainId).toBeUndefined()

    const hiddenLegacy = getProject(legacy.id)
    expect(hiddenLegacy?.archived).toBe(true)
    expect(hiddenLegacy?.visibility).toBe('system')

    const projects = listVisibleProjects()
    expect(projects[0]?.id).toBe(selfDialogue.id)
    expect(projects.some((project) => project.id === legacy.id)).toBe(false)
  })
})
