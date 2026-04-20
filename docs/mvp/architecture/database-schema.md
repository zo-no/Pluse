# Pluse 数据库 Schema

数据库位置：`~/.pluse/runtime/pluse.db`（SQLite，WAL 模式）

---

```sql
CREATE TABLE projects (
  id            TEXT PRIMARY KEY NOT NULL,
  name          TEXT NOT NULL,
  work_dir      TEXT NOT NULL,
  goal          TEXT,
  system_prompt TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
) STRICT;


CREATE TABLE quests (
  id                   TEXT PRIMARY KEY NOT NULL,
  project_id           TEXT NOT NULL REFERENCES projects(id),
  kind                 TEXT NOT NULL DEFAULT 'session',
  created_by           TEXT NOT NULL DEFAULT 'human',

  -- provider context（项目内唯一，非主键，kind 切换时保留）
  codex_thread_id      TEXT,
  claude_session_id    TEXT,

  -- 运行时偏好（共用）
  tool                 TEXT,
  model                TEXT,
  effort               TEXT,   -- 'low' | 'medium' | 'high'
  thinking             INTEGER DEFAULT 0,
  active_run_id        TEXT,

  -- session 态
  name                 TEXT,
  auto_rename_pending  INTEGER DEFAULT 1,  -- 新建 session 时默认开启自动命名
  pinned               INTEGER DEFAULT 0,
  follow_up_queue      TEXT NOT NULL DEFAULT '[]',

  -- task 态（kind 切换时保留，不清空）
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

  -- 归档（软删除）= deleted，归档区折叠展示，可恢复
  deleted              INTEGER NOT NULL DEFAULT 0,
  deleted_at           TEXT,

  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_quests_codex_thread
  ON quests (project_id, codex_thread_id)
  WHERE codex_thread_id IS NOT NULL;

CREATE UNIQUE INDEX idx_quests_claude_session
  ON quests (project_id, claude_session_id)
  WHERE claude_session_id IS NOT NULL;

CREATE INDEX idx_quests_project
  ON quests (project_id, kind, deleted, pinned DESC, updated_at DESC);

CREATE INDEX idx_quests_status
  ON quests (project_id, kind, status);


CREATE TABLE todos (
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
) STRICT;

CREATE INDEX idx_todos_project ON todos (project_id, deleted, status, updated_at DESC);


CREATE TABLE runs (
  id                    TEXT PRIMARY KEY NOT NULL,
  quest_id              TEXT NOT NULL REFERENCES quests(id),
  project_id            TEXT NOT NULL REFERENCES projects(id),
  request_id            TEXT NOT NULL,

  trigger               TEXT NOT NULL DEFAULT 'chat',   -- 'chat' | 'manual' | 'automation'
  triggered_by          TEXT NOT NULL DEFAULT 'human',  -- 'human' | 'scheduler' | 'api' | 'cli'

  state                 TEXT NOT NULL DEFAULT 'accepted',
  -- 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled'
  failure_reason        TEXT,
  -- state='failed' 时：'timeout' | 'process_lost' | 'error'

  tool                  TEXT NOT NULL DEFAULT 'codex',
  model                 TEXT NOT NULL,
  effort                TEXT,   -- 'low' | 'medium' | 'high'
  thinking              INTEGER DEFAULT 0,

  codex_thread_id       TEXT,
  claude_session_id     TEXT,

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

CREATE INDEX idx_runs_quest ON runs (quest_id, created_at DESC);
CREATE INDEX idx_runs_project ON runs (project_id, created_at DESC);


CREATE TABLE run_spool (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id  TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  ts      TEXT NOT NULL,
  line    TEXT NOT NULL
) STRICT;

CREATE INDEX idx_run_spool_run ON run_spool (run_id, id ASC);


CREATE TABLE quest_ops (
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
) STRICT;

CREATE INDEX idx_quest_ops_quest ON quest_ops (quest_id, created_at DESC);


CREATE TABLE settings (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
) STRICT;
```
