import { beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import type { Project } from '@pluse/types'
import { buildSessionSystemPrompt, buildTaskSystemPrompt } from '../services/system-prompt'
import { resetTestDb, setupTestDb } from './helpers'

beforeAll(() => setupTestDb())
beforeEach(() => resetTestDb())

const mockProject: Project = {
  id: 'proj_test',
  name: 'Test Project',
  workDir: '/tmp/test-project',
  goal: '构建一个测试工具',
  systemPrompt: '请使用简洁的代码风格',
  archived: false,
  pinned: false,
  visibility: 'user',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

describe('buildSessionSystemPrompt', () => {
  it('includes Pluse concept block', () => {
    const prompt = buildSessionSystemPrompt(mockProject, 'sess_abc')
    expect(prompt).toContain('你在 Pluse 系统中运行')
    expect(prompt).toContain('Project（项目）')
    expect(prompt).toContain('Session（会话）')
    expect(prompt).toContain('Task（任务）')
  })

  it('includes session context header', () => {
    const prompt = buildSessionSystemPrompt(mockProject, 'sess_abc')
    expect(prompt).toContain('当前上下文：会话')
    expect(prompt).toContain('sess_abc')
    expect(prompt).toContain('proj_test')
    expect(prompt).toContain('Test Project')
    expect(prompt).toContain('/tmp/test-project')
  })

  it('includes project system prompt (layer 2)', () => {
    const prompt = buildSessionSystemPrompt(mockProject, 'sess_abc')
    expect(prompt).toContain('请使用简洁的代码风格')
  })

  it('includes project goal (layer 2)', () => {
    const prompt = buildSessionSystemPrompt(mockProject, 'sess_abc')
    expect(prompt).toContain('构建一个测试工具')
  })

  it('includes commands hint', () => {
    const prompt = buildSessionSystemPrompt(mockProject, 'sess_abc')
    expect(prompt).toContain('commands')
    expect(prompt).toContain('查看所有可用能力')
  })

  it('does NOT include task execution instructions', () => {
    const prompt = buildSessionSystemPrompt(mockProject, 'sess_abc')
    expect(prompt).not.toContain('当前上下文：任务执行')
    expect(prompt).not.toContain('task done')
  })

  it('omits empty project fields gracefully', () => {
    const minimalProject: Project = {
      ...mockProject,
      goal: undefined,
      systemPrompt: undefined,
    }
    const prompt = buildSessionSystemPrompt(minimalProject, 'sess_abc')
    expect(prompt).toContain('你在 Pluse 系统中运行')
    expect(prompt).toContain('当前上下文：会话')
  })
})

describe('buildTaskSystemPrompt', () => {
  it('includes Pluse concept block', () => {
    const prompt = buildTaskSystemPrompt(mockProject, 'task_abc', 'Write tests', 'sess_abc')
    expect(prompt).toContain('你在 Pluse 系统中运行')
    expect(prompt).toContain('Task.originSessionId')
  })

  it('includes task execution context header', () => {
    const prompt = buildTaskSystemPrompt(mockProject, 'task_abc', 'Write tests', 'sess_abc')
    expect(prompt).toContain('当前上下文：任务执行')
    expect(prompt).toContain('task_abc')
    expect(prompt).toContain('Write tests')
    expect(prompt).toContain('sess_abc')
    expect(prompt).toContain('proj_test')
  })

  it('includes task done instruction with correct taskId', () => {
    const prompt = buildTaskSystemPrompt(mockProject, 'task_xyz', 'Deploy app', 'sess_abc')
    expect(prompt).toContain('task done task_xyz')
  })

  it('includes task get instruction for traceability', () => {
    const prompt = buildTaskSystemPrompt(mockProject, 'task_xyz', 'Deploy app', 'sess_abc')
    expect(prompt).toContain('task get task_xyz')
    expect(prompt).toContain('originSessionId')
  })

  it('includes project system prompt (layer 2)', () => {
    const prompt = buildTaskSystemPrompt(mockProject, 'task_abc', 'Write tests', 'sess_abc')
    expect(prompt).toContain('请使用简洁的代码风格')
  })

  it('does NOT include session conversation instructions', () => {
    const prompt = buildTaskSystemPrompt(mockProject, 'task_abc', 'Write tests', 'sess_abc')
    expect(prompt).not.toContain('当前上下文：会话')
    expect(prompt).not.toContain('你正在与人类对话')
  })
})

describe('Session vs Task prompt difference', () => {
  it('session and task prompts are distinct', () => {
    const sessionPrompt = buildSessionSystemPrompt(mockProject, 'sess_abc')
    const taskPrompt = buildTaskSystemPrompt(mockProject, 'task_abc', 'Write tests', 'sess_abc')
    expect(sessionPrompt).not.toBe(taskPrompt)
    expect(sessionPrompt).toContain('当前上下文：会话')
    expect(taskPrompt).toContain('当前上下文：任务执行')
  })

  it('both share the Pluse concept block', () => {
    const sessionPrompt = buildSessionSystemPrompt(mockProject, 'sess_abc')
    const taskPrompt = buildTaskSystemPrompt(mockProject, 'task_abc', 'Write tests', 'sess_abc')
    const sharedText = '你在 Pluse 系统中运行'
    expect(sessionPrompt).toContain(sharedText)
    expect(taskPrompt).toContain(sharedText)
  })
})
