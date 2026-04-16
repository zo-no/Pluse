import { existsSync, readFileSync } from 'node:fs'
import type { ApiResult } from '@melody-sync/types'
import { getOrCreateApiToken, hasAuth } from '../models/auth'
import { getServerMetadataPath } from './paths'

export type CliMode = 'auto' | 'daemon' | 'offline'

interface ServerMetadata {
  port: number
}

function readServerMetadata(): ServerMetadata | null {
  const path = getServerMetadataPath()
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ServerMetadata
  } catch {
    return null
  }
}

export function getCliMode(): CliMode {
  const mode = (process.env['PULSE_CLI_MODE']?.trim().toLowerCase() || 'auto') as CliMode
  return mode === 'daemon' || mode === 'offline' ? mode : 'auto'
}

export async function discoverDaemonBaseUrl(): Promise<string | null> {
  const metadata = readServerMetadata()
  if (!metadata?.port) return null
  const baseUrl = `http://127.0.0.1:${metadata.port}`
  try {
    const res = await fetch(`${baseUrl}/health`)
    if (!res.ok) return null
    return baseUrl
  } catch {
    return null
  }
}

export async function resolveDaemonBaseUrl(mode: CliMode, opts: { requireWrite?: boolean } = {}): Promise<string | null> {
  const baseUrl = await discoverDaemonBaseUrl()
  if (mode === 'daemon' && !baseUrl) {
    throw new Error('Pulse daemon is not available')
  }
  if (mode === 'offline') {
    if (opts.requireWrite && baseUrl) {
      throw new Error('Offline write operations are blocked while the Pulse daemon is running')
    }
    return null
  }
  return baseUrl
}

export async function daemonRequest<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = process.env['PULSE_API_TOKEN']?.trim() || (hasAuth() ? getOrCreateApiToken() : '')
  const headers = new Headers(init.headers ?? {})
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(`${baseUrl}${path}`, { ...init, headers })
  const json = await res.json() as ApiResult<T>
  if (!json.ok) {
    throw new Error(json.error)
  }
  return json.data
}
