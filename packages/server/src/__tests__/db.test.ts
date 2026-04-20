import { afterEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { setDb } from '../db'

let db: Database | null = null

afterEach(() => {
  if (!db) return
  try {
    db.close(false)
  } catch {
    // ignore close races in tests
  }
  db = null
})

describe('database schema init', () => {
  it('adds domain_id before creating the projects domain index on legacy databases', () => {
    db = new Database(':memory:')
    db.run(`CREATE TABLE projects (
      id            TEXT PRIMARY KEY NOT NULL,
      name          TEXT NOT NULL,
      work_dir      TEXT NOT NULL,
      goal          TEXT,
      system_prompt TEXT,
      archived      INTEGER NOT NULL DEFAULT 0,
      pinned        INTEGER NOT NULL DEFAULT 0,
      visibility    TEXT NOT NULL DEFAULT 'user',
      created_by    TEXT NOT NULL DEFAULT 'human',
      order_index   INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    ) STRICT`)

    expect(() => setDb(db!)).not.toThrow()

    const columns = db.query<{ name: string }, []>('PRAGMA table_info(projects)').all().map((row) => row.name)
    expect(columns).toContain('domain_id')
  })
})
