import { describe, expect, it } from 'bun:test'
import { getCommandCatalog } from '../controllers/http/commands'

describe('command catalog', () => {
  it('exposes the full project command set', () => {
    const catalog = getCommandCatalog()
    const projectModule = catalog.modules.find((module) => module.name === 'project')

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
  })

  it('keeps quest as the only session/task entrypoint', () => {
    const catalog = getCommandCatalog()
    const moduleNames = catalog.modules.map((module) => module.name)
    const questModule = catalog.modules.find((module) => module.name === 'quest')

    expect(moduleNames).not.toContain('session')
    expect(moduleNames).not.toContain('task')
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
  })
})
