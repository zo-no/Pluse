import { getSetting, setSetting } from '../models/settings'

const SETTING_KEY = 'cli_catalog_command'

export function getCliCatalogCommand(): string {
  return getSetting(SETTING_KEY)?.trim() ?? ''
}

export function saveCliCatalogCommand(input: string | null | undefined): string {
  const command = input?.trim() ?? ''
  setSetting(SETTING_KEY, command)
  return command
}

export function buildCliCatalogPromptBlock(): string {
  const command = getCliCatalogCommand()
  if (!command) return ''

  return [
    '外部 CLI 集合：',
    '用户声明可通过以下命令查看当前环境可用的外部 CLI / 指令集合；Pluse 未执行校验，也不会代为执行。',
    `运行 \`${command}\` 查看所有可用外部 CLI 指令。`,
  ].join('\n')
}
