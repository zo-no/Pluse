import { Database } from 'bun:sqlite'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiResult } from '@pluse/types'
import { setDb } from '../db'
import { app } from '../server'

let mem: Database | null = null
let runtimeRoot: string | null = null

function closeDb(): void {
  if (!mem) return
  try {
    mem.close(false)
  } catch {
    // ignore close races in tests
  }
  mem = null
}

function resetRuntimeRoot(): string {
  if (runtimeRoot) {
    rmSync(runtimeRoot, { recursive: true, force: true })
  }
  runtimeRoot = mkdtempSync(join(tmpdir(), 'pluse-test-'))
  process.env['PLUSE_ROOT'] = runtimeRoot
  delete process.env['PLUSE_DB_PATH']
  return runtimeRoot
}

export function setupTestDb(): Database {
  return resetTestDb()
}

export function resetTestDb(): Database {
  closeDb()
  resetRuntimeRoot()
  mem = new Database(':memory:')
  setDb(mem)
  return mem
}

export function getTestRoot(): string {
  if (!runtimeRoot) {
    resetRuntimeRoot()
  }
  return runtimeRoot!
}

export function makeWorkDir(name: string): string {
  const path = join(getTestRoot(), name)
  mkdirSync(path, { recursive: true })
  return path
}

type ApiRequestOptions = {
  headers?: HeadersInit
}

export async function apiReq<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  options: ApiRequestOptions = {},
): Promise<{ status: number; json: ApiResult<T>; headers: Headers }> {
  const headers = new Headers(options.headers ?? {})
  const init: RequestInit = { method, headers }
  if (body !== undefined) {
    if (body instanceof FormData) {
      // let the runtime set Content-Type with boundary
      init.body = body
    } else {
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
      init.body = JSON.stringify(body)
    }
  }
  const res = await app.request(`http://localhost${path}`, init)
  const json = (await res.json()) as ApiResult<T>
  return { status: res.status, json, headers: res.headers }
}

export const GET = <T = unknown>(path: string, options?: ApiRequestOptions) => apiReq<T>('GET', path, undefined, options)
export const POST = <T = unknown>(path: string, body?: unknown, options?: ApiRequestOptions) => apiReq<T>('POST', path, body, options)
export const PATCH = <T = unknown>(path: string, body: unknown, options?: ApiRequestOptions) => apiReq<T>('PATCH', path, body, options)
export const DEL = <T = unknown>(path: string, options?: ApiRequestOptions) => apiReq<T>('DELETE', path, undefined, options)

export async function waitFor<T>(
  probe: () => T | Promise<T>,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 5_000
  const intervalMs = options.intervalMs ?? 25
  const deadline = Date.now() + timeoutMs
  let lastError: unknown = null

  while (Date.now() < deadline) {
    try {
      return await probe()
    } catch (error) {
      lastError = error
      await Bun.sleep(intervalMs)
    }
  }

  throw lastError ?? new Error(`Timed out after ${timeoutMs}ms`)
}
