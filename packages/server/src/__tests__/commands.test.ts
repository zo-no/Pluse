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
})
