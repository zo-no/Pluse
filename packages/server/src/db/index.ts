import { Database } from 'bun:sqlite'
import { dirname } from 'node:path'
import { ensureDir, getDbPath } from '../support/paths'

function getTableColumns(db: Database, table: string): Set<string> {
  const rows = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all()
  return new Set(rows.map((row) => row.name))
}

function ensureColumn(db: Database, table: string, column: string, ddl: string): void {
  if (!getTableColumns(db, table).has(column)) {
    db.run(ddl)
  }
}

function initSchema(db: Database): void {
  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA foreign_keys = ON')
  db.run('PRAGMA busy_timeout = 5000')

  db.run(`CREATE TABLE IF NOT EXISTS domains (
    id           TEXT PRIMARY KEY NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    icon         TEXT,
    color        TEXT,
    order_index  INTEGER NOT NULL DEFAULT 0,
    deleted      INTEGER NOT NULL DEFAULT 0,
    deleted_at   TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  ) STRICT`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_domains_active
    ON domains (deleted, order_index, updated_at DESC)`)

  db.run(`CREATE TABLE IF NOT EXISTS projects (
    id            TEXT PRIMARY KEY NOT NULL,
    name          TEXT NOT NULL,
    work_dir      TEXT NOT NULL,
    goal          TEXT,
    system_prompt TEXT,
    domain_id     TEXT REFERENCES domains(id),
    archived      INTEGER NOT NULL DEFAULT 0,
    pinned        INTEGER NOT NULL DEFAULT 0,
    visibility    TEXT NOT NULL DEFAULT 'user',
    created_by    TEXT NOT NULL DEFAULT 'human',
    order_index   INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  ) STRICT`)

  ensureColumn(db, 'projects', 'domain_id', 'ALTER TABLE projects ADD COLUMN domain_id TEXT REFERENCES domains(id)')
  ensureColumn(db, 'projects', 'description', 'ALTER TABLE projects ADD COLUMN description TEXT')
  ensureColumn(db, 'projects', 'icon', 'ALTER TABLE projects ADD COLUMN icon TEXT')

  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_work_dir
    ON projects (work_dir)
    WHERE work_dir IS NOT NULL AND visibility = 'user'`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_projects_updated
    ON projects (visibility, archived, pinned DESC, updated_at DESC)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_projects_domain
    ON projects (domain_id, updated_at DESC)`)

  db.run(`CREATE TABLE IF NOT EXISTS quests (
    id                   TEXT PRIMARY KEY NOT NULL,
    project_id           TEXT NOT NULL REFERENCES projects(id),
    kind                 TEXT NOT NULL DEFAULT 'session',
    created_by           TEXT NOT NULL DEFAULT 'human',
    codex_thread_id      TEXT,
    claude_session_id    TEXT,
    tool                 TEXT,
    model                TEXT,
    effort               TEXT,
    thinking             INTEGER DEFAULT 0,
    active_run_id        TEXT,
    name                 TEXT,
    auto_rename_pending  INTEGER DEFAULT 1,
    session_category_id  TEXT REFERENCES session_categories(id),
    pinned               INTEGER DEFAULT 0,
    follow_up_queue      TEXT NOT NULL DEFAULT '[]',
    title                TEXT,
    description          TEXT,
    status               TEXT NOT NULL DEFAULT 'idle',
    enabled              INTEGER NOT NULL DEFAULT 1,
    schedule_kind        TEXT,
    schedule_config      TEXT,
    executor_kind        TEXT,
    executor_config      TEXT,
    executor_options     TEXT,
    completion_output    TEXT,
    review_on_complete   INTEGER NOT NULL DEFAULT 0,
    order_index          INTEGER,
    deleted              INTEGER NOT NULL DEFAULT 0,
    deleted_at           TEXT,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL
  ) STRICT`)

  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_quests_codex_thread
    ON quests (project_id, codex_thread_id)
    WHERE codex_thread_id IS NOT NULL`)
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_quests_claude_session
    ON quests (project_id, claude_session_id)
    WHERE claude_session_id IS NOT NULL`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_quests_project
    ON quests (project_id, kind, deleted, pinned DESC, updated_at DESC)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_quests_status
    ON quests (project_id, kind, status)`)

  db.run(`CREATE TABLE IF NOT EXISTS session_categories (
    id            TEXT PRIMARY KEY NOT NULL,
    project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    description   TEXT,
    collapsed     INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  ) STRICT`)
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_session_categories_project_name
    ON session_categories (project_id, name)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_session_categories_project_name_sort
    ON session_categories (project_id, name COLLATE NOCASE, created_at)`)

  db.run(`CREATE TABLE IF NOT EXISTS todos (
    id                   TEXT PRIMARY KEY NOT NULL,
    project_id           TEXT NOT NULL REFERENCES projects(id),
    created_by           TEXT NOT NULL DEFAULT 'human',
    origin_quest_id      TEXT REFERENCES quests(id),
    title                TEXT NOT NULL,
    description          TEXT,
    waiting_instructions TEXT,
    due_at               TEXT,
    repeat               TEXT NOT NULL DEFAULT 'none',
    status               TEXT NOT NULL DEFAULT 'pending',
    deleted              INTEGER NOT NULL DEFAULT 0,
    deleted_at           TEXT,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL
  ) STRICT`)
  ensureColumn(db, 'quests', 'unread', 'ALTER TABLE quests ADD COLUMN unread INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'quests', 'session_category_id', 'ALTER TABLE quests ADD COLUMN session_category_id TEXT REFERENCES session_categories(id)')
  ensureColumn(db, 'todos', 'deleted', 'ALTER TABLE todos ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'todos', 'deleted_at', 'ALTER TABLE todos ADD COLUMN deleted_at TEXT')
  ensureColumn(db, 'todos', 'due_at', 'ALTER TABLE todos ADD COLUMN due_at TEXT')
  ensureColumn(db, 'todos', 'repeat', "ALTER TABLE todos ADD COLUMN repeat TEXT NOT NULL DEFAULT 'none'")
  ensureColumn(db, 'todos', 'priority', "ALTER TABLE todos ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'")
  ensureColumn(db, 'todos', 'tags', "ALTER TABLE todos ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'")
  db.run('DROP INDEX IF EXISTS idx_todos_project')
  db.run(`CREATE INDEX IF NOT EXISTS idx_todos_project
    ON todos (project_id, deleted, status, updated_at DESC)`)

  db.run(`CREATE TABLE IF NOT EXISTS runs (
    id                    TEXT PRIMARY KEY NOT NULL,
    quest_id              TEXT NOT NULL REFERENCES quests(id),
    project_id            TEXT NOT NULL REFERENCES projects(id),
    request_id            TEXT NOT NULL,
    trigger               TEXT NOT NULL DEFAULT 'chat',
    triggered_by          TEXT NOT NULL DEFAULT 'human',
    state                 TEXT NOT NULL DEFAULT 'accepted',
    failure_reason        TEXT,
    tool                  TEXT NOT NULL DEFAULT 'codex',
    model                 TEXT NOT NULL,
    effort                TEXT,
    thinking              INTEGER DEFAULT 0,
    claude_session_id     TEXT,
    codex_thread_id       TEXT,
    cancel_requested      INTEGER DEFAULT 0,
    runner_process_id     INTEGER,
    context_input_tokens  INTEGER,
    context_window_tokens INTEGER,
    created_at            TEXT NOT NULL,
    started_at            TEXT,
    updated_at            TEXT NOT NULL,
    completed_at          TEXT,
    finalized_at          TEXT
  ) STRICT`)

  db.run(`CREATE INDEX IF NOT EXISTS idx_runs_quest
    ON runs (quest_id, created_at DESC)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_runs_project
    ON runs (project_id, created_at DESC)`)
  ensureColumn(db, 'runs', 'input_tokens',          'ALTER TABLE runs ADD COLUMN input_tokens INTEGER')
  ensureColumn(db, 'runs', 'output_tokens',         'ALTER TABLE runs ADD COLUMN output_tokens INTEGER')
  ensureColumn(db, 'runs', 'cache_read_tokens',     'ALTER TABLE runs ADD COLUMN cache_read_tokens INTEGER')
  ensureColumn(db, 'runs', 'cache_creation_tokens', 'ALTER TABLE runs ADD COLUMN cache_creation_tokens INTEGER')
  ensureColumn(db, 'runs', 'cost_usd',              'ALTER TABLE runs ADD COLUMN cost_usd REAL')

  db.run(`CREATE TABLE IF NOT EXISTS reminders (
    id              TEXT PRIMARY KEY NOT NULL,
    project_id      TEXT NOT NULL REFERENCES projects(id),
    created_by      TEXT NOT NULL DEFAULT 'human',
    origin_quest_id TEXT REFERENCES quests(id),
    origin_run_id   TEXT REFERENCES runs(id),
    type            TEXT NOT NULL DEFAULT 'custom',
    title           TEXT NOT NULL,
    body            TEXT,
    remind_at       TEXT,
    priority        TEXT NOT NULL DEFAULT 'normal',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  ) STRICT`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_reminders_project
    ON reminders (project_id, remind_at, updated_at DESC)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_reminders_origin_quest
    ON reminders (origin_quest_id, type, updated_at DESC)`)

  db.run(`CREATE TABLE IF NOT EXISTS reminder_project_priorities (
    project_id      TEXT PRIMARY KEY NOT NULL REFERENCES projects(id),
    priority        TEXT NOT NULL DEFAULT 'normal',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  ) STRICT`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_reminder_project_priorities_priority
    ON reminder_project_priorities (priority, updated_at DESC)`)

  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id              TEXT PRIMARY KEY NOT NULL,
    project_id      TEXT NOT NULL REFERENCES projects(id),
    created_by      TEXT NOT NULL DEFAULT 'system',
    origin_quest_id TEXT REFERENCES quests(id),
    origin_run_id   TEXT REFERENCES runs(id),
    type            TEXT NOT NULL,
    title           TEXT NOT NULL,
    body            TEXT,
    status          TEXT NOT NULL DEFAULT 'unread',
    deleted         INTEGER NOT NULL DEFAULT 0,
    deleted_at      TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  ) STRICT`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_notifications_project
    ON notifications (project_id, deleted, status, updated_at DESC)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_notifications_origin_quest
    ON notifications (origin_quest_id, type, deleted, status, updated_at DESC)`)

  db.run(`CREATE TABLE IF NOT EXISTS run_spool (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id  TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    ts      TEXT NOT NULL,
    line    TEXT NOT NULL
  ) STRICT`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_run_spool_run
    ON run_spool(run_id, id ASC)`)

  db.run(`CREATE TABLE IF NOT EXISTS quest_ops (
    id          TEXT PRIMARY KEY NOT NULL,
    quest_id    TEXT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
    op          TEXT NOT NULL,
    from_kind   TEXT,
    to_kind     TEXT,
    from_status TEXT,
    to_status   TEXT,
    actor       TEXT NOT NULL,
    note        TEXT,
    created_at  TEXT NOT NULL
  ) STRICT`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_quest_ops_quest
    ON quest_ops(quest_id, created_at DESC)`)

  db.run(`CREATE TABLE IF NOT EXISTS project_activity (
    id           TEXT PRIMARY KEY NOT NULL,
    project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    subject_type TEXT NOT NULL,
    subject_id   TEXT NOT NULL,
    quest_id     TEXT,
    title        TEXT NOT NULL,
    op           TEXT NOT NULL,
    actor        TEXT NOT NULL,
    from_kind    TEXT,
    to_kind      TEXT,
    from_status  TEXT,
    to_status    TEXT,
    note         TEXT,
    created_at   TEXT NOT NULL
  ) STRICT`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_project_activity_project
    ON project_activity(project_id, created_at DESC)`)

  db.run(`CREATE TABLE IF NOT EXISTS assets (
    id          TEXT PRIMARY KEY NOT NULL,
    quest_id    TEXT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    saved_path  TEXT NOT NULL,
    mime_type   TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL,
    created_at  TEXT NOT NULL
  ) STRICT`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_assets_quest
    ON assets(quest_id, created_at DESC)`)

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
