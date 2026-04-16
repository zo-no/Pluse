import { getDb } from '../db'

function now(): string {
  return new Date().toISOString()
}

export function getSetting(key: string): string | null {
  const db = getDb()
  const row = db.query<{ value: string }, [string]>(
    'SELECT value FROM settings WHERE key = ?'
  ).get(key)
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  const db = getDb()
  db.run(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, now()],
  )
}
