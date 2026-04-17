import { Database } from 'bun:sqlite'
import { dirname } from 'node:path'
import { ensureDir, getDbPath } from '../support/paths'

function hasColumn(db: Database, table: string, column: string): boolean {
  const rows = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all()
  return rows.some((row) => row.name === column)
}

function ensureColumn(db: Database, table: string, column: string, definition: string): void {
  if (hasColumn(db, table, column)) return
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

function initSchema(db: Database): void {
  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA foreign_keys = ON')
  db.run('PRAGMA busy_timeout = 5000')

  db.run(`CREATE TABLE IF NOT EXISTS projects (
    id            TEXT PRIMARY KEY NOT NULL,
    name          TEXT NOT NULL,
    goal          TEXT,
    work_dir      TEXT,
    system_prompt TEXT,
    archived      INTEGER NOT NULL DEFAULT 0,
    pinned        INTEGER NOT NULL DEFAULT 0,
    visibility    TEXT NOT NULL DEFAULT 'user',
    created_by    TEXT NOT NULL DEFAULT 'human',
    order_index   INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  ) STRICT`)

  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_work_dir
    ON projects (work_dir)
    WHERE work_dir IS NOT NULL AND visibility = 'user'`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_projects_updated
    ON projects (visibility, archived, pinned DESC, updated_at DESC)`)

  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id                  TEXT PRIMARY KEY NOT NULL,
    project_id          TEXT NOT NULL REFERENCES projects(id),
    name                TEXT NOT NULL,
    created_by          TEXT NOT NULL DEFAULT 'human',
    source_task_id      TEXT REFERENCES tasks(id),
    auto_rename_pending INTEGER DEFAULT 0,
    tool                TEXT,
    model               TEXT,
    effort              TEXT,
    thinking            INTEGER DEFAULT 0,
    claude_session_id   TEXT,
    codex_thread_id     TEXT,
    active_run_id       TEXT,
    follow_up_queue     TEXT NOT NULL DEFAULT '[]',
    pinned              INTEGER DEFAULT 0,
    archived            INTEGER DEFAULT 0,
    archived_at         TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  ) STRICT`)

  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_project
    ON sessions (project_id, archived, pinned DESC, updated_at DESC)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_list
    ON sessions (archived, updated_at DESC)`)

  db.run(`CREATE TABLE IF NOT EXISTS runs (
    id                    TEXT PRIMARY KEY NOT NULL,
    session_id            TEXT NOT NULL REFERENCES sessions(id),
    request_id            TEXT NOT NULL,
    state                 TEXT NOT NULL DEFAULT 'accepted',
    tool                  TEXT NOT NULL DEFAULT 'codex',
    model                 TEXT NOT NULL,
    effort                TEXT,
    thinking              INTEGER DEFAULT 0,
    claude_session_id     TEXT,
    codex_thread_id       TEXT,
    cancel_requested      INTEGER DEFAULT 0,
    result                TEXT,
    failure_reason        TEXT,
    runner_process_id     INTEGER,
    context_input_tokens  INTEGER,
    context_window_tokens INTEGER,
    created_at            TEXT NOT NULL,
    started_at            TEXT,
    updated_at            TEXT NOT NULL,
    completed_at          TEXT,
    finalized_at          TEXT
  ) STRICT`)

  db.run(`CREATE INDEX IF NOT EXISTS idx_runs_session
    ON runs (session_id, created_at DESC)`)

  db.run(`CREATE TABLE IF NOT EXISTS tasks (
    id                   TEXT PRIMARY KEY NOT NULL,
    project_id           TEXT NOT NULL REFERENCES projects(id),
    created_by           TEXT NOT NULL DEFAULT 'human',
    origin_session_id    TEXT REFERENCES sessions(id),
    session_id           TEXT REFERENCES sessions(id),
    title                TEXT NOT NULL,
    description          TEXT,
    assignee             TEXT NOT NULL DEFAULT 'human',
    kind                 TEXT NOT NULL DEFAULT 'once',
    status               TEXT NOT NULL DEFAULT 'pending',
    order_index          INTEGER,
    schedule_config      TEXT,
    executor_kind        TEXT,
    executor_config      TEXT,
    executor_options     TEXT,
    waiting_instructions TEXT,
    blocked_by_task_id   TEXT REFERENCES tasks(id),
    completion_output    TEXT,
    review_on_complete   INTEGER NOT NULL DEFAULT 0,
    enabled              INTEGER NOT NULL DEFAULT 1,
    last_session_id      TEXT,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL
  ) STRICT`)

  db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_project_status
    ON tasks (project_id, status, updated_at DESC)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_session
    ON tasks (session_id, updated_at DESC)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_assignee
    ON tasks (project_id, assignee, status)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_blocked
    ON tasks (blocked_by_task_id)`)

  db.run(`CREATE TABLE IF NOT EXISTS task_logs (
    id           TEXT PRIMARY KEY NOT NULL,
    task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    status       TEXT NOT NULL,
    triggered_by TEXT NOT NULL,
    output       TEXT,
    error        TEXT,
    skip_reason  TEXT,
    started_at   TEXT NOT NULL,
    completed_at TEXT
  ) STRICT`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_task_logs_task
    ON task_logs(task_id, started_at DESC)`)

  db.run(`CREATE TABLE IF NOT EXISTS task_ops (
    id          TEXT PRIMARY KEY NOT NULL,
    task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    op          TEXT NOT NULL,
    from_status TEXT,
    to_status   TEXT,
    actor       TEXT NOT NULL,
    note        TEXT,
    created_at  TEXT NOT NULL
  ) STRICT`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_task_ops_task
    ON task_ops(task_id, created_at DESC)`)

  db.run(`CREATE TABLE IF NOT EXISTS task_runs (
    id           TEXT PRIMARY KEY NOT NULL,
    task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    project_id    TEXT NOT NULL REFERENCES projects(id),
    session_id    TEXT,
    status        TEXT NOT NULL DEFAULT 'running',
    triggered_by  TEXT NOT NULL,
    started_at    TEXT NOT NULL,
    completed_at  TEXT,
    error         TEXT
  ) STRICT`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_task_runs_task
    ON task_runs(task_id, started_at DESC)`)

  db.run(`CREATE TABLE IF NOT EXISTS task_run_spool (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id  TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
    ts      TEXT NOT NULL,
    line    TEXT NOT NULL
  ) STRICT`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_task_run_spool_run
    ON task_run_spool(run_id, id ASC)`)

  db.run(`CREATE TABLE IF NOT EXISTS auth (
    id         TEXT PRIMARY KEY NOT NULL,
    kind       TEXT NOT NULL,
    value      TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT`)

  db.run(`CREATE TABLE IF NOT EXISTS auth_sessions (
    id         TEXT PRIMARY KEY NOT NULL,
    csrf_token TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen  TEXT NOT NULL,
    expires_at TEXT
  ) STRICT`)

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY NOT NULL,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT`)

  if (hasColumn(db, 'projects', 'path')) {
    ensureColumn(db, 'projects', 'work_dir', 'TEXT')
    db.run(`UPDATE projects SET work_dir = path WHERE work_dir IS NULL AND path IS NOT NULL`)
  }

  ensureColumn(db, 'projects', 'goal', 'TEXT')
  ensureColumn(db, 'projects', 'archived', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'projects', 'pinned', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'projects', 'visibility', "TEXT NOT NULL DEFAULT 'user'")
  ensureColumn(db, 'projects', 'created_by', "TEXT NOT NULL DEFAULT 'human'")
  ensureColumn(db, 'projects', 'order_index', 'INTEGER NOT NULL DEFAULT 0')

  // sessions: new fields
  ensureColumn(db, 'sessions', 'created_by', "TEXT NOT NULL DEFAULT 'human'")
  ensureColumn(db, 'sessions', 'source_task_id', 'TEXT')

  // tasks: new fields
  ensureColumn(db, 'tasks', 'session_id', 'TEXT')
  ensureColumn(db, 'tasks', 'origin_session_id', 'TEXT')
  ensureColumn(db, 'tasks', 'review_on_complete', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'tasks', 'last_session_id', 'TEXT')

  ensureColumn(db, 'auth_sessions', 'csrf_token', "TEXT NOT NULL DEFAULT ''")
}

let dbInstance: Database | null = null

export function getDb(): Database {
  if (dbInstance) return dbInstance
  const dbPath = getDbPath()
  ensureDir(dirname(dbPath))
  dbInstance = new Database(dbPath, { create: true })
  initSchema(dbInstance)
  return dbInstance
}

export function setDb(instance: Database): void {
  dbInstance = instance
  initSchema(dbInstance)
}
