import { Command } from 'commander'
import { getOrCreateApiToken, setCredentials } from '../../models/auth'

export const authCommand = new Command('auth')
authCommand.description('Manage Pulse auth helpers')

authCommand
  .command('setup')
  .description('Configure local Pulse login credentials')
  .requiredOption('--password <password>', 'Password for web login')
  .option('--username <username>', 'Optional username for web login')
  .action((options: { username?: string; password: string }) => {
    setCredentials({
      username: options.username,
      password: options.password,
    })
    console.log(`configured auth${options.username ? ` for ${options.username}` : ''}`)
  })

authCommand
  .command('token')
  .description('Print the local Pulse API token')
  .action(() => {
    console.log(getOrCreateApiToken())
  })
