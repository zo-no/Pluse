#!/usr/bin/env bun
import { Command } from 'commander'
import { authCommand } from './controllers/cli/auth'
import { projectCommand } from './controllers/cli/project'
import { sessionCommand } from './controllers/cli/session'
import { taskCommand } from './controllers/cli/task'

const program = new Command()

program
  .name('pulse')
  .description('Pulse CLI — manage projects, sessions, and tasks')
  .version('0.1.0')

program.addCommand(authCommand)
program.addCommand(projectCommand)
program.addCommand(sessionCommand)
program.addCommand(taskCommand)

program.parse(process.argv)
