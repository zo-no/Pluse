import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { openProject } from '../services/projects'
import { stopScheduler } from '../services/scheduler'
import { makeWorkDir, resetTestDb, setupTestDb } from './helpers'

beforeAll(() => setupTestDb())

beforeEach(() => {
  stopScheduler()
  resetTestDb()
})

describe('project agent.md scaffold', () => {
  it('creates an empty agent.md when a brand-new project is opened', () => {
    const workDir = makeWorkDir('proj-fresh')
    openProject({ workDir, name: 'fresh' })

    const agentPath = join(workDir, 'agent.md')
    expect(existsSync(agentPath)).toBe(true)
    expect(readFileSync(agentPath, 'utf8')).toBe('')
  })

  it('does not overwrite a pre-existing agent.md on first open', () => {
    const workDir = makeWorkDir('proj-with-existing-agent')
    const agentPath = join(workDir, 'agent.md')
    writeFileSync(agentPath, '# 已有项目级约定\n')

    openProject({ workDir, name: 'preset' })

    expect(readFileSync(agentPath, 'utf8')).toBe('# 已有项目级约定\n')
  })

  it('does not re-create agent.md when re-opening if the user deleted it', () => {
    const workDir = makeWorkDir('proj-deleted-agent')
    openProject({ workDir, name: 'will-delete' })

    const agentPath = join(workDir, 'agent.md')
    expect(existsSync(agentPath)).toBe(true)

    rmSync(agentPath)
    expect(existsSync(agentPath)).toBe(false)

    openProject({ workDir, name: 'will-delete' })

    expect(existsSync(agentPath)).toBe(false)
  })
})
