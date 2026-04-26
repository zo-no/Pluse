import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

function resolveHomePath(value: string): string {
  if (value.startsWith('~/')) {
    return resolve(homedir(), value.slice(2))
  }
  return resolve(value)
}

export function getPluseRoot(): string {
  return resolveHomePath(
    process.env['PLUSE_ROOT']?.trim()
    || process.env['PULSE_ROOT']?.trim()
    || join(homedir(), '.pluse'),
  )
}

export function ensureDir(path: string): string {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
  }
  return path
}

export function getDbPath(): string {
  return resolveHomePath(
    process.env['PLUSE_DB_PATH']?.trim()
    || process.env['PULSE_DB_PATH']?.trim()
    || join(getPluseRoot(), 'runtime', 'pluse.db'),
  )
}

export function getHistoryRoot(): string {
  return ensureDir(join(dirname(getDbPath()), 'quests'))
}

export function getRunRoot(): string {
  return ensureDir(join(getPluseRoot(), 'runtime'))
}

export function getServerMetadataPath(): string {
  return join(getRunRoot(), 'server.json')
}

export function getInboxDir(): string {
  return ensureDir(join(getPluseRoot(), 'inbox'))
}

export function getDefaultEntryProjectDir(): string {
  return ensureDir(join(getPluseRoot(), 'self-dialogue'))
}

export function getSystemRuntimeDir(): string {
  return ensureDir(join(getPluseRoot(), 'system', 'runtime'))
}

export function getManagedCodexHome(): string {
  return ensureDir(join(getPluseRoot(), 'system', 'codex-home'))
}

export function resolveWorkDir(workDir: string): string {
  return resolveHomePath(workDir)
}

export function getProjectManifestDir(workDir: string): string {
  return join(resolveWorkDir(workDir), '.pluse')
}

export function getGlobalHooksPath(): string {
  return join(getPluseRoot(), 'hooks.json')
}

export function getProjectHooksPath(workDir: string): string {
  return join(getProjectManifestDir(workDir), 'hooks.json')
}

export function getProjectManifestPath(workDir: string): string {
  return join(getProjectManifestDir(workDir), 'project.json')
}

export function getAssetsDir(questId: string): string {
  return ensureDir(join(getPluseRoot(), 'assets', questId))
}

export function getWebDistRoot(): string {
  const override = process.env['PLUSE_WEB_DIST']?.trim() || process.env['PULSE_WEB_DIST']?.trim()
  if (override) return resolveHomePath(override)

  const candidates = [
    resolve(process.cwd(), 'packages/web/dist'),
    resolve(import.meta.dir, '../../../web/dist'),
    resolve(import.meta.dir, '../../web/dist'),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return candidates[0]!
}
