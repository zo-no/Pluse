import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { getDb } from '../db'

export const SESSION_COOKIE_NAME = 'pulse_session'
export const CSRF_COOKIE_NAME = 'pulse_csrf'
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 }
const HASH_LEN = 32

function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, HASH_LEN, SCRYPT_PARAMS)
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('hex')}$${hash.toString('hex')}`
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, N, r, p, saltHex, hashHex] = parts
  const salt = Buffer.from(saltHex, 'hex')
  const storedHash = Buffer.from(hashHex, 'hex')
  try {
    const inputHash = scryptSync(password, salt, HASH_LEN, {
      N: parseInt(N, 10),
      r: parseInt(r, 10),
      p: parseInt(p, 10),
    })
    return timingSafeEqual(storedHash, inputHash)
  } catch {
    return false
  }
}

function timingSafeHexCompare(inputToken: string, expected: string): boolean {
  try {
    const input = Buffer.from(inputToken, 'hex')
    const target = Buffer.from(expected, 'hex')
    if (input.length !== target.length) {
      timingSafeEqual(Buffer.alloc(target.length), target)
      return false
    }
    return timingSafeEqual(input, target)
  } catch {
    return false
  }
}

function createSessionRecord(): { sessionToken: string; csrfToken: string } {
  const db = getDb()
  const sessionToken = randomBytes(32).toString('hex')
  const csrfToken = randomBytes(24).toString('hex')
  const ts = new Date().toISOString()
  db.run(
    `INSERT INTO auth_sessions (id, csrf_token, created_at, last_seen, expires_at)
     VALUES (?, ?, ?, ?, NULL)`,
    [sessionToken, csrfToken, ts, ts],
  )
  return { sessionToken, csrfToken }
}

export function hasAuth(): boolean {
  const db = getDb()
  const row = db.query<{ id: string }, []>('SELECT id FROM auth LIMIT 1').get()
  return !!row
}

export function setUsername(username: string): void {
  const db = getDb()
  db.run(
    `INSERT OR REPLACE INTO auth (id, kind, value, created_at) VALUES ('username', 'username', ?, ?)`,
    [username.trim(), new Date().toISOString()],
  )
}

export function getUsername(): string | null {
  const db = getDb()
  const row = db.query<{ value: string }, []>(
    `SELECT value FROM auth WHERE id = 'username' AND kind = 'username'`
  ).get()
  return row?.value?.trim() || null
}

export function setPassword(password: string): void {
  const db = getDb()
  db.run(
    `INSERT OR REPLACE INTO auth (id, kind, value, created_at) VALUES ('password', 'password', ?, ?)`,
    [hashPassword(password), new Date().toISOString()],
  )
}

export function setCredentials(input: { username?: string | null; password: string }): void {
  if (input.username?.trim()) setUsername(input.username)
  setPassword(input.password)
}

export function getOrCreateApiToken(): string {
  const db = getDb()
  const existing = db.query<{ value: string }, []>(
    `SELECT value FROM auth WHERE id = 'token' AND kind = 'token'`
  ).get()
  if (existing?.value) return existing.value

  const token = randomBytes(32).toString('hex')
  db.run(
    `INSERT OR REPLACE INTO auth (id, kind, value, created_at) VALUES ('token', 'token', ?, ?)`,
    [token, new Date().toISOString()],
  )
  return token
}

export function verifyApiToken(token: string): boolean {
  const db = getDb()
  const row = db.query<{ value: string }, []>(
    `SELECT value FROM auth WHERE id = 'token' AND kind = 'token'`
  ).get()
  if (!row) return false
  return timingSafeHexCompare(token, row.value)
}

export function loginWithPassword(password: string, username?: string | null): { sessionToken: string; csrfToken: string } | null {
  const db = getDb()
  const configuredUsername = getUsername()
  if (configuredUsername && configuredUsername !== (username?.trim() || '')) return null
  const row = db.query<{ value: string }, []>(
    `SELECT value FROM auth WHERE id = 'password' AND kind = 'password'`
  ).get()
  if (!row || !verifyPassword(password, row.value)) return null
  return createSessionRecord()
}

export function loginWithToken(token: string): { sessionToken: string; csrfToken: string } | null {
  if (!verifyApiToken(token)) return null
  return createSessionRecord()
}

export function validateAuthSession(token: string): { valid: boolean; csrfToken?: string } {
  if (!token) return { valid: false }
  const db = getDb()
  const row = db.query<{ id: string; csrf_token: string }, [string]>(
    `SELECT id, csrf_token FROM auth_sessions WHERE id = ?`
  ).get(token)
  if (!row) return { valid: false }
  db.run(`UPDATE auth_sessions SET last_seen = ? WHERE id = ?`, [new Date().toISOString(), token])
  return { valid: true, csrfToken: row.csrf_token }
}

export function deleteAuthSession(token: string): void {
  const db = getDb()
  db.run(`DELETE FROM auth_sessions WHERE id = ?`, [token])
}

export function makeSessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/`
}

export function makeCsrfCookie(token: string): string {
  return `${CSRF_COOKIE_NAME}=${token}; SameSite=Lax; Path=/`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
}

export function clearCsrfCookie(): string {
  return `${CSRF_COOKIE_NAME}=; SameSite=Lax; Path=/; Max-Age=0`
}

function parseCookieValue(cookieHeader: string | undefined, key: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [k, v] = part.trim().split('=')
    if (k === key && v) return v
  }
  return null
}

export function parseSessionToken(cookieHeader: string | undefined): string | null {
  return parseCookieValue(cookieHeader, SESSION_COOKIE_NAME)
}

export function parseCsrfCookie(cookieHeader: string | undefined): string | null {
  return parseCookieValue(cookieHeader, CSRF_COOKIE_NAME)
}
