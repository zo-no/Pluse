import { Command } from 'commander'
import { getOrCreateApiToken } from '../../models/auth'

export const authCommand = new Command('auth')
authCommand.description('Manage Pulse auth helpers')

authCommand
  .command('token')
  .description('Print the local Pulse API token')
  .action(() => {
    console.log(getOrCreateApiToken())
  })
