# 数据库 Schema

数据库位置：`~/.melodysync/runtime/sessions.db`（SQLite，WAL 模式）

---

## projects 表

```sql
CREATE TABLE projects (
  id            TEXT PRIMARY KEY NOT NULL,  -- 'proj_' + hex
  name          TEXT NOT NULL,
  path          TEXT NOT NULL,              -- 本地文件夹绝对路径
  system_prompt TEXT,                       -- 项目级 system prompt
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
) STRICT;

CREATE INDEX idx_projects_updated ON projects(updated_at DESC);
```

---

## sessions 表

```sql
CREATE TABLE sessions (
  id                  TEXT PRIMARY KEY NOT NULL,  -- 'sess_' + hex
  project_id          TEXT NOT NULL REFERENCES projects(id),
  name                TEXT NOT NULL,
  auto_rename_pending INTEGER DEFAULT 0,
  model               TEXT,
  effort              TEXT,
  thinking            INTEGER DEFAULT 0,
  active_run_id       TEXT,
  follow_up_queue     TEXT NOT NULL DEFAULT '[]',  -- JSON 数组
  pinned              INTEGER DEFAULT 0,
  archived            INTEGER DEFAULT 0,
  archived_at         TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
) STRICT;

CREATE INDEX idx_sessions_project ON sessions(project_id, pinned DESC, updated_at DESC);
CREATE INDEX idx_sessions_list    ON sessions(archived, updated_at DESC);
```

---

## session_events 表

```sql
CREATE TABLE session_events (
  id           TEXT PRIMARY KEY NOT NULL,
  session_id   TEXT NOT NULL REFERENCES sessions(id),
  seq          INTEGER NOT NULL,
  type         TEXT NOT NULL,   -- message/reasoning/tool_use/tool_result/status/file_change/usage
  role         TEXT,            -- user/assistant
  content      TEXT,            -- inline body（message/reasoning）
  tool_input   TEXT,            -- inline body（tool_use）
  output       TEXT,            -- inline body（tool_result）
  body_ref     TEXT,            -- 外部化文件引用
  body_bytes   INTEGER,
  body_preview TEXT,            -- 外部化时的截断预览
  body_truncated INTEGER DEFAULT 0,
  timestamp    INTEGER NOT NULL,
  created_at   TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_session_events_seq     ON session_events(session_id, seq);
CREATE INDEX        idx_session_events_session ON session_events(session_id, timestamp DESC);
```

---

## runs 表

```sql
CREATE TABLE runs (
  id                    TEXT PRIMARY KEY NOT NULL,  -- 'run_' + hex
  session_id            TEXT NOT NULL REFERENCES sessions(id),
  request_id            TEXT NOT NULL,
  state                 TEXT NOT NULL DEFAULT 'accepted',
  result                TEXT,
  failure_reason        TEXT,
  model                 TEXT NOT NULL,
  effort                TEXT,
  thinking              INTEGER DEFAULT 0,
  cancel_requested      INTEGER DEFAULT 0,
  runner_process_id     INTEGER,
  context_input_tokens  INTEGER,
  context_window_tokens INTEGER,
  created_at            TEXT NOT NULL,
  started_at            TEXT,
  updated_at            TEXT NOT NULL,
  completed_at          TEXT,
  finalized_at          TEXT
) STRICT;

CREATE INDEX idx_runs_session ON runs(session_id, created_at DESC);
```

---

## auth 表

```sql
CREATE TABLE auth (
  id         TEXT PRIMARY KEY NOT NULL,  -- 'password' | 'token_<hex>'
  kind       TEXT NOT NULL,              -- 'password' | 'token'
  value      TEXT NOT NULL,              -- bcrypt hash（password）或明文 token
  created_at TEXT NOT NULL
) STRICT;
```

## auth_sessions 表

```sql
CREATE TABLE auth_sessions (
  id         TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  last_seen  TEXT NOT NULL,
  expires_at TEXT   -- null = 永不过期
) STRICT;
```

## settings 表

```sql
CREATE TABLE settings (
  key        TEXT PRIMARY KEY NOT NULL,
  value      TEXT NOT NULL,              -- JSON
  updated_at TEXT NOT NULL
) STRICT;
```

**已知 key：**

| key | 说明 |
|---|---|
| `runtime_selection` | 全局默认 model/effort/thinking，新建会话时作为初始值 |
