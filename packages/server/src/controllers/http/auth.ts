import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import type { ApiResult, AuthMe } from '@pluse/types'
import {
  clearCsrfCookie,
  clearSessionCookie,
  deleteAuthSession,
  getUsername,
  hasAuth,
  loginWithPassword,
  loginWithToken,
  makeCsrfCookie,
  makeSessionCookie,
  parseSessionToken,
  validateAuthSession,
} from '../../models/auth'

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

function errBody(error: string): ApiResult<never> {
  return { ok: false, error }
}

function sc(n: number): ContentfulStatusCode {
  return n as ContentfulStatusCode
}

const LoginSchema = z.union([
  z.object({ username: z.string().trim().min(1).optional(), password: z.string().min(1) }),
  z.object({ token: z.string().min(1) }),
])

export const authRouter = new Hono()

authRouter.post('/auth/login', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(errBody('Invalid JSON body'), sc(400))
  }

  const parsed = LoginSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))

  const session = 'password' in parsed.data
    ? loginWithPassword(parsed.data.password, parsed.data.username)
    : loginWithToken(parsed.data.token)

  if (!session) return c.json(errBody('Invalid credentials'), sc(401))

  c.header('Set-Cookie', makeSessionCookie(session.sessionToken), { append: true })
  c.header('Set-Cookie', makeCsrfCookie(session.csrfToken), { append: true })
  return c.json(ok({ ok: true }))
})

authRouter.post('/auth/logout', (c) => {
  const token = parseSessionToken(c.req.header('cookie'))
  if (token) deleteAuthSession(token)
  c.header('Set-Cookie', clearSessionCookie(), { append: true })
  c.header('Set-Cookie', clearCsrfCookie(), { append: true })
  return c.json(ok({ ok: true }))
})

authRouter.get('/api/auth/me', (c) => {
  const token = parseSessionToken(c.req.header('cookie'))
  const authenticated = token ? validateAuthSession(token).valid : false
  const data: AuthMe = {
    authenticated,
    setupRequired: !hasAuth(),
    username: getUsername(),
  }
  return c.json(ok(data))
})
