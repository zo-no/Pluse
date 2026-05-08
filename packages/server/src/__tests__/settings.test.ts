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
      expect(prompt).toContain('把 Progress 当作当前 Quest 的执行计划，而不是汇报面板。')
      expect(prompt).toContain('满足任一条件就先创建完整 progress，再开始执行')
      expect(prompt).toContain('开始执行前先读取已有 progress；有未完成项就续写，不要重复建计划。')
      expect(prompt).toContain('先创建 3-5 个中层阶段，体现长程规划')
      expect(prompt).toContain('Progress 条目只记录用户可理解的阶段目标')
      expect(prompt).toContain('微动作只能写进 `active-form`')
      expect(prompt).toContain('每次只允许一个步骤处于 `doing`。')
      expect(prompt).toContain('每个实现类步骤后都必须有验证步骤。')
      expect(prompt).toContain('分析 / 实现 / 验证')
      expect(prompt).toContain('progress list --quest-id')
      expect(prompt).toContain('progress create --quest-id')
      expect(prompt).toContain('progress update')
      expect(prompt).toContain('progress wait')
      expect(prompt).not.toContain('todo progress-create')
    }

    expect(sessionPrompt).toContain('优先在当前 Quest 的 Progress 流中创建 waiting 条目')
    expect(taskPrompt).toContain('优先在当前 Quest 的 Progress 流中创建 waiting 条目')
    expect(taskPrompt).not.toContain('需要人类介入时，优先创建 Reminder')
  })

  it('does not inject an empty CLI catalog command', () => {
    const prompt = buildSessionSystemPrompt(testProject(), testQuest('session'))

    expect(prompt).not.toContain('外部 CLI 集合')
  })
})
