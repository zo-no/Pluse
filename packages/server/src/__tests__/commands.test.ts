import { describe, expect, it } from 'bun:test'
import { getCommandCatalog } from '../controllers/http/commands'

describe('command catalog', () => {
  it('exposes the full project command set', () => {
    const catalog = getCommandCatalog()
    const projectModule = catalog.modules.find((module) => module.name === 'project')
    const domainModule = catalog.modules.find((module) => module.name === 'domain')

    expect(projectModule).toBeTruthy()
    expect(projectModule?.commands.map((command) => command.name)).toEqual([
      'project list',
      'project get',
      'project overview',
      'project open',
      'project update',
      'project archive',
      'project delete',
    ])
    expect(projectModule?.commands.find((command) => command.name === 'project open')?.cli).toContain('--domain-id <id>')
    expect(projectModule?.commands.find((command) => command.name === 'project update')?.cli).toContain('--clear-domain')

    expect(domainModule).toBeTruthy()
    expect(domainModule?.commands.map((command) => command.name)).toEqual([
      'domain list',
      'domain defaults',
      'domain create',
      'domain update',
      'domain delete',
    ])
  })

  it('keeps quest as the only session/task entrypoint', () => {
    const catalog = getCommandCatalog()
    const moduleNames = catalog.modules.map((module) => module.name)
    const questModule = catalog.modules.find((module) => module.name === 'quest')
    const progressModule = catalog.modules.find((module) => module.name === 'progress')

    expect(moduleNames).not.toContain('session')
    expect(moduleNames).not.toContain('task')
    expect(moduleNames).toEqual(['quest', 'progress', 'todo', 'reminder', 'check-in', 'run', 'project', 'domain', 'session-category', 'asset', 'commands'])
    expect(questModule).toBeTruthy()
    expect(questModule?.description).toContain('统一入口')
    expect(questModule?.commands.map((command) => command.name)).toEqual([
      'quest list',
      'quest get',
      'quest create',
      'quest update',
      'quest move',
      'quest message',
      'quest run',
    ])
    expect(questModule?.commands.find((command) => command.name === 'quest create')?.cli).toContain('--schedule-kind')
    expect(questModule?.commands.find((command) => command.name === 'quest update')?.api).toBe('PATCH /api/quests/<id>')

    expect(progressModule).toBeTruthy()
    expect(progressModule?.commands.map((command) => command.name)).toEqual([
      'progress list',
      'progress create',
      'progress update',
      'progress wait',
    ])
    expect(progressModule?.commands.find((command) => command.name === 'progress create')?.cli).toContain('pluse progress create')
    expect(progressModule?.commands.find((command) => command.name === 'progress create')?.description).toContain('AI plan/progress tracking')

    const todoModule = catalog.modules.find((module) => module.name === 'todo')
    expect(todoModule?.commands.map((command) => command.name)).toEqual([
      'todo list',
      'todo get',
      'todo create',
      'todo done',
      'todo update',
      'todo delete',
      'todo progress-create',
      'todo progress-update',
      'todo progress-wait',
    ])
    expect(todoModule?.commands.find((command) => command.name === 'todo list')?.api).toContain('/api/quests/<id>/progress')
    expect(todoModule?.commands.find((command) => command.name === 'todo list')?.description).toContain('兼容入口')
    expect(todoModule?.commands.find((command) => command.name === 'todo progress-create')?.description).toContain('兼容别名')
  })
})
