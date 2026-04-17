import { Command } from 'commander'
import { getCommandCatalog } from '../http/commands'

export const commandsCommand = new Command('commands')
commandsCommand
  .description('List all available Pulse CLI commands and API endpoints')
  .option('--json', 'Output as JSON', false)
  .action((opts: { json: boolean }) => {
    const catalog = getCommandCatalog()
    if (opts.json) {
      console.log(JSON.stringify(catalog, null, 2))
      return
    }
    for (const mod of catalog.modules) {
      console.log(`\n${mod.name} — ${mod.description}`)
      for (const cmd of mod.commands) {
        console.log(`  ${cmd.name}`)
        console.log(`    CLI: ${cmd.cli}`)
        console.log(`    API: ${cmd.api}`)
        console.log(`    ${cmd.description}`)
      }
    }
  })
