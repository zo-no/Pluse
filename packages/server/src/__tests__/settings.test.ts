import { beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import type { ApiResult, AppSettings, Project, Quest } from '@pluse/types'
import { buildSessionSystemPrompt, buildTaskSystemPrompt } from '../services/system-prompt'
import { GET, PATCH, resetTestDb, setupTestDb } from './helpers'

function mustOk<T>(response: { json: ApiResult<T> }): T {
  expect(response.json.ok).toBe(true)
  if (!response.json.ok) {
    throw new Error(response.json.error)
  }
  return response.json.data
}

function testProject(): Project {
  return {
    id: 'proj_settings',
    name: 'Settings Project',
    workDir: '/tmp/settings-project',
    archived: false,
    pinned: false,
    priority: 'normal',
    visibility: 'user',
    createdAt: '2026-04-29T00:00:00.000Z',
    updatedAt: '2026-04-29T00:00:00.000Z',
  }
}

function testQuest(kind: 'session' | 'task'): Quest {
  return {
    id: `quest_${kind}`,
    projectId: 'proj_settings',
    kind,
    createdBy: 'human',
    createdAt: '2026-04-29T00:00:00.000Z',
    updatedAt: '2026-04-29T00:00:00.000Z',
    followUpQueue: [],
    ...(kind === 'session' ? { name: 'CLI chat' } : { title: 'CLI task' }),
  }
}

beforeAll(() => setupTestDb())

beforeEach(() => resetTestDb())

describe('settings API', () => {
  it('returns an empty CLI catalog command by default', async () => {
    const settings = await GET<AppSettings>('/api/settings')

    expect(settings.status).toBe(200)
    expect(mustOk(settings).cliCatalogCommand).toBe('')
  })

  it('saves, trims, and returns the CLI catalog command', async () => {
    const updated = await PATCH<AppSettings>('/api/settings', {
      cliCatalogCommand: ' my-cli commands ',
    })

    expect(updated.status).toBe(200)
    const data = mustOk(updated)
    expect(data.cliCatalogCommand).toBe('my-cli commands')

    const loaded = await GET<AppSettings>('/api/settings')
    expect(mustOk(loaded).cliCatalogCommand).toBe('my-cli commands')
  })

  it('clears the CLI catalog command with blank or null input', async () => {
    const updated = await PATCH<AppSettings>('/api/settings', {
      cliCatalogCommand: ' my-cli commands ',
    })
    expect(updated.status).toBe(200)

    const cleared = await PATCH<AppSettings>('/api/settings', {
      cliCatalogCommand: null,
    })
    expect(cleared.status).toBe(200)
    expect(mustOk(cleared).cliCatalogCommand).toBe('')
  })

  it('injects the CLI catalog command into session and task prompts', async () => {
    const updated = await PATCH<AppSettings>('/api/settings', {
      cliCatalogCommand: 'my-cli commands',
    })
    expect(updated.status).toBe(200)

    const sessionPrompt = buildSessionSystemPrompt(testProject(), testQuest('session'))
    const taskPrompt = buildTaskSystemPrompt(testProject(), testQuest('task'))

    for (const prompt of [sessionPrompt, taskPrompt]) {
      expect(prompt).toContain('外部 CLI 集合')
      expect(prompt).toContain('Pluse 未执行校验')
      expect(prompt).toContain('运行 `my-cli commands` 查看所有可用外部 CLI 指令')
    }
  })

  it('does not inject an empty CLI catalog command', () => {
    const prompt = buildSessionSystemPrompt(testProject(), testQuest('session'))

    expect(prompt).not.toContain('外部 CLI 集合')
  })
})
