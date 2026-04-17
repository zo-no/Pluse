import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

function resolveHomePath(value: string): string {
  if (value.startsWith('~/')) {
    return resolve(homedir(), value.slice(2))
  }
  return resolve(value)
}

export function getPulseRoot(): string {
  return resolveHomePath(process.env['PULSE_ROOT']?.trim() || join(homedir(), '.pulse'))
}

export function ensureDir(path: string): string {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
  }
  return path
}

export function getDbPath(): string {
  return resolveHomePath(process.env['PULSE_DB_PATH']?.trim() || join(getPulseRoot(), 'db.sqlite'))
}

export function getHistoryRoot(): string {
  return ensureDir(join(dirname(getDbPath()), 'history'))
}

export function getRunRoot(): string {
  return ensureDir(join(getPulseRoot(), 'run'))
}

export function getServerMetadataPath(): string {
  return join(getRunRoot(), 'server.json')
}

export function getInboxDir(): string {
  return ensureDir(join(getPulseRoot(), 'inbox'))
}

export function getSystemRuntimeDir(): string {
  return ensureDir(join(getPulseRoot(), 'system', 'runtime'))
}

export function resolveWorkDir(workDir: string): string {
  return resolveHomePath(workDir)
}

export function getProjectManifestDir(workDir: string): string {
  return join(resolveWorkDir(workDir), '.pulse')
}

export function getProjectManifestPath(workDir: string): string {
  return join(getProjectManifestDir(workDir), 'project.json')
}

export function getAssetsDir(sessionId: string): string {
  return ensureDir(join(getPulseRoot(), 'assets', sessionId))
}

export function getWebDistRoot(): string {
  const override = process.env['PULSE_WEB_DIST']?.trim()
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
