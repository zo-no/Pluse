import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ApiResult } from '@pluse/types'

// ─── Structured error classes ────────────────────────────────────────────────

export class NotFoundError extends Error {
  readonly resource: string
  readonly id: string
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`)
    this.name = 'NotFoundError'
    this.resource = resource
    this.id = id
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

// ─── HTTP helpers (shared across all controllers) ────────────────────────────

export function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

export function errBody(error: string): ApiResult<never> {
  return { ok: false, error }
}

export function sc(n: number): ContentfulStatusCode {
  return n as ContentfulStatusCode
}

/**
 * Map a caught service/model error to the appropriate HTTP status code.
 * Use in controller catch blocks instead of string-matching error messages.
 *
 * Usage:
 *   try { ... }
 *   catch (error) { return c.json(errBody(String(error)), httpStatus(error)) }
 */
export function httpStatus(error: unknown): ContentfulStatusCode {
  if (error instanceof NotFoundError) return sc(404)
  if (error instanceof ConflictError) return sc(409)
  if (error instanceof ValidationError) return sc(400)
  // Legacy string-match fallback for errors not yet migrated
  const msg = String(error)
  if (msg.includes('not found') || msg.includes('Not found')) return sc(404)
  if (
    msg.includes('UNIQUE constraint failed')
    || msg.includes('active run')
    || msg.includes('already belongs to project')
    || msg.includes('already has a quest using')
    || msg.includes('cannot accept quest')
    || msg.includes('QUEST_RUN_CONFLICT')
  ) return sc(409)
  return sc(400)
}
