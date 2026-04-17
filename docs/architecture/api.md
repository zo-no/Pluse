# HTTP & CLI API

所有 HTTP 路由挂载在 `/api/*`，需要 Cookie 认证（`ms_session`）。

响应格式统一：
```typescript
{ ok: true, data: T }         // 成功
{ ok: false, error: string }  // 失败
```

---

## Auth

### POST /auth/login
```json
// 请求
{ "password": "..." }

// 响应：Set-Cookie: ms_session=<token>; HttpOnly
{ "ok": true, "data": { "sessionId": "..." } }
```

### POST /auth/logout
清除 Cookie，删除 auth_session 记录。

### GET /api/auth/me
返回当前认证状态。

---

## Projects

### GET /api/projects
返回所有项目，按 updated_at 倒序。

```typescript
// 响应
{ ok: true, data: Project[] }
```

### POST /api/projects
```json
// 请求
{ "name": "My Project", "path": "/Users/foo/my-project", "systemPrompt": "..." }

// 响应 201
{ "ok": true, "data": Project }
```

### GET /api/projects/:id
### PATCH /api/projects/:id
```json
// 请求（所有字段可选）
{ "name": "...", "path": "...", "systemPrompt": "..." }
```

### DELETE /api/projects/:id
删除项目及其下所有 Session（级联）。

---

## Sessions

### GET /api/sessions?projectId=&archived=
```typescript
// 响应
{ ok: true, data: Session[] }
```

- `projectId`：过滤指定项目（必填，或传 `all` 获取全部）
- `archived`：`true` / `false`（默认 false）

### POST /api/sessions
```json
// 请求
{ "projectId": "proj_...", "name": "New Session", "model": "claude-opus-4-5", "effort": "normal", "thinking": false }
```

### GET /api/sessions/:id
### PATCH /api/sessions/:id
```json
// 可更新字段
{ "name": "...", "model": "...", "effort": "...", "thinking": true, "pinned": true, "archived": false, "autoRenamePending": false }
```

### DELETE /api/sessions/:id

---

## Session Events（历史）

### GET /api/sessions/:id/events
```typescript
// Query params
{ limit?: number, offset?: number }

// 响应
{ ok: true, data: { items: SessionEvent[], total: number, offset: number, limit: number } }
```

### GET /api/sessions/:id/events/:seq/body
获取外部化事件的完整 body。

```typescript
{ ok: true, data: { body: string } }
```

### GET /api/sessions/:id/events/block/:startSeq/:endSeq
获取一个区间内的事件（用于 reasoning 折叠块展开）。

---

## Messages（发送消息）

### POST /api/sessions/:id/messages
```json
// 请求
{
  "requestId": "req_...",    // 幂等键
  "text": "...",
  "attachments": [           // 可选
    { "type": "file", "assetId": "...", "name": "foo.ts", "mimeType": "text/plain" }
  ]
}

// 响应 202
{
  "ok": true,
  "data": {
    "queued": false,         // true = 进了 follow-up queue
    "run": Run | null,       // 立即执行时返回新 Run
    "session": Session
  }
}
```

---

## Runs

### GET /api/sessions/:id/runs
返回该 Session 的所有 Run，按 created_at 倒序。

### GET /api/runs/:id
### POST /api/runs/:id/cancel

---

## WebSocket

连接：`ws://localhost:7761/ws`（需 Cookie 认证）

**服务端推送（只推不收）：**

```typescript
// session 状态变化（metadata、activeRunId、events 追加）
{ type: 'session_invalidated', sessionId: string }

// 项目列表变化
{ type: 'projects_invalidated' }

// session 列表变化（新建/删除/归档）
{ type: 'sessions_invalidated', projectId: string }

// Run 流式 delta（执行中实时推送）
{ type: 'run_delta', runId: string, sessionId: string, delta: SpoolDelta }
```

客户端收到 `*_invalidated` 后通过 HTTP 重新拉取数据，WebSocket 不是数据源。

---

## CLI

CLI 直接操作本地 SQLite，不需要认证。

```bash
melodysync project list
melodysync project create --name "My Project" --path /path/to/folder
melodysync project delete <id>

melodysync session list --project <projectId>
melodysync session get <id>
melodysync session create --project <projectId> --name "New Session"
melodysync session archive <id>
melodysync session delete <id>

melodysync run list --session <sessionId>
melodysync run get <id>
melodysync run cancel <id>

melodysync storage-maintenance  # 清理 7 天前的 spool 和 run 文件
```

所有命令支持 `--json` 输出。
