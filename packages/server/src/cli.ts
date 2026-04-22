#!/usr/bin/env bun
import { Command } from 'commander'
import { authCommand } from './controllers/cli/auth'
import { commandsCommand } from './controllers/cli/commands'
import { domainCommand } from './controllers/cli/domain'
import { projectCommand } from './controllers/cli/project'
import { questCommand } from './controllers/cli/quest'
import { runCommand } from './controllers/cli/run'
import { sessionCategoryCommand } from './controllers/cli/session-category'
import { todoCommand } from './controllers/cli/todo'

const program = new Command()

program
  .name('pluse')
  .description('Pluse CLI — manage projects, quests, todos, and runs')
  .version('0.1.0')

program.addCommand(authCommand)
program.addCommand(commandsCommand)
program.addCommand(domainCommand)
program.addCommand(projectCommand)
program.addCommand(questCommand)
program.addCommand(runCommand)
program.addCommand(sessionCategoryCommand)
program.addCommand(todoCommand)

program.parse(process.argv)
