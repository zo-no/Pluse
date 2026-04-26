import { beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import type { Project } from '@pluse/types'
import { getOrCreateApiToken, loginWithPassword, setCredentials, setPassword } from '../models/auth'
import { GET, POST, makeWorkDir, resetTestDb, setupTestDb } from './helpers'

beforeAll(() => setupTestDb())
beforeEach(() => resetTestDb())

function makeCookieHeader(sessionToken: string, csrfToken: string): string {
  return `pulse_session=${sessionToken}; pulse_csrf=${csrfToken}`
}

function cookieHeaderFromSetCookie(headers: Headers): string {
  const value = headers.get('set-cookie') ?? ''
  return value
    .split(/,(?=\s*pulse_)/)
    .map((part) => part.trim().split(';')[0])
    .filter(Boolean)
    .join('; ')
}

describe('auth middleware', () => {
  it('rejects business API access before auth is configured', async () => {
    const opened = await POST<Project>(
      '/api/projects/open',
      { workDir: makeWorkDir('no-auth'), name: 'No Auth' },
      { auth: false },
    )
    expect(opened.status).toBe(401)
    expect(opened.json.ok).toBe(false)
  })

  it('accepts password login without a username when username auth is not configured', async () => {
    setPassword('secret')

    const login = await POST<{ ok: true }>('/auth/login', {
      username: '',
      password: 'secret',
    })
    expect(login.status).toBe(200)
    expect(login.json.ok).toBe(true)
  })

  it('sets cookies on web login and accepts them for API reads', async () => {
    setPassword('secret')

    const login = await POST<{ ok: true }>('/auth/login', { password: 'secret' })
    expect(login.status).toBe(200)

    const cookie = cookieHeaderFromSetCookie(login.headers)
    expect(cookie).toContain('pulse_session=')
    expect(cookie).toContain('pulse_csrf=')

    const projects = await GET<Project[]>('/api/projects', {
      headers: { Cookie: cookie },
    })
    expect(projects.status).toBe(200)
    expect(projects.json.ok).toBe(true)
  })

  it('accepts bearer tokens for authenticated API access', async () => {
    setPassword('secret')
    const token = getOrCreateApiToken()

    const unauthorized = await GET<Project[]>('/api/projects', { auth: false })
    expect(unauthorized.status).toBe(401)

    const authorized = await GET<Project[]>('/api/projects', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    expect(authorized.status).toBe(200)
    expect(authorized.json.ok).toBe(true)
  })

  it('requires CSRF for cookie-authenticated writes', async () => {
    setPassword('secret')
    const session = loginWithPassword('secret')
    expect(session).not.toBeNull()
    if (!session) return

    const cookie = makeCookieHeader(session.sessionToken, session.csrfToken)

    const forbidden = await POST<Project>(
      '/api/projects/open',
      { workDir: makeWorkDir('cookie-forbidden'), name: 'Forbidden' },
      { headers: { Cookie: cookie } },
    )
    expect(forbidden.status).toBe(403)

    const allowed = await POST<Project>(
      '/api/projects/open',
      { workDir: makeWorkDir('cookie-allowed'), name: 'Allowed' },
      {
        headers: {
          Cookie: cookie,
          'X-CSRF-Token': session.csrfToken,
        },
      },
    )
    expect(allowed.status).toBe(201)
    expect(allowed.json.ok).toBe(true)
  })

  it('requires the configured username when username auth is enabled', () => {
    setCredentials({ username: 'zono', password: '021115' })

    expect(loginWithPassword('021115')).toBeNull()
    expect(loginWithPassword('021115', 'other')).toBeNull()
    expect(loginWithPassword('021115', 'zono')).not.toBeNull()
  })
})
