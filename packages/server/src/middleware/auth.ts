import type { Context, Next } from 'hono'
import type { ApiResult } from '@pluse/types'
import {
  hasAuth,
  parseCsrfCookie,
  parseSessionToken,
  validateAuthSession,
  verifyApiToken,
} from '../models/auth'

function unauthorized(c: Context, message = 'Unauthorized'): Response {
  const body: ApiResult<never> = { ok: false, error: message }
  return c.json(body, 401)
}

function forbidden(c: Context, message = 'Forbidden'): Response {
  const body: ApiResult<never> = { ok: false, error: message }
  return c.json(body, 403)
}

function isWriteMethod(method: string): boolean {
  return method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE'
}

function extractBearerToken(c: Context): string | null {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  return authHeader.slice(7).trim() || null
}

export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  if (!hasAuth()) return next()

  const bearerToken = extractBearerToken(c)
  if (bearerToken) {
    if (!verifyApiToken(bearerToken)) return unauthorized(c)
    c.set('authMode', 'bearer')
    return next()
  }

  const cookieHeader = c.req.header('cookie')
  const sessionToken = parseSessionToken(cookieHeader)
  const session = sessionToken ? validateAuthSession(sessionToken) : { valid: false }
  if (!session.valid) return unauthorized(c)

  if (isWriteMethod(c.req.method)) {
    const csrfCookie = parseCsrfCookie(cookieHeader)
    const csrfHeader = c.req.header('X-CSRF-Token')?.trim() || null
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader || csrfCookie !== session.csrfToken) {
      return forbidden(c, 'Missing or invalid CSRF token')
    }
  }

  c.set('authMode', 'cookie')
  return next()
}
