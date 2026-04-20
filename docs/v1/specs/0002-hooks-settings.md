# 0002 — Hooks 设置：用户可控的 Todo 推送开关

## 背景

`0001-hooks.md` 实现了 hooks 机制，AI 完成一轮后可以高亮会话、创建 Human Todo。
但目前用户无法在 UI 里控制是否开启 Todo 推送，只能手动编辑 `hooks.json` 文件。

## 目标

- 用户可以在设置页面开启/关闭"会话完成后创建待办"
- 接口完全 CLI 化：读写文件，不走数据库
- Agent 也可以直接修改 `hooks.json` 达到同样效果

## 设计原则

**CLI 优先**：所有配置存在 `~/.pluse/hooks.json`（全局）或 `{workDir}/.pluse/hooks.json`（项目级），
不入数据库，可以 git 追踪，Agent 可直接读写。

## hooks.json 变更：新增 `enabled` 字段

```json
{
  "hooks": [
    {
      "id": "notify-on-session-complete",
      "enabled": true,
      "event": "run_completed",
      "filter": { "kind": "session", "triggeredBy": ["human"] },
      "actions": [
        { "type": "highlight_quest" },
        { "type": "create_todo", "title": "查看会话：{{quest.name}}" }
      ]
    }
  ]
}
```

- `enabled: true`（默认）— 正常执行
- `enabled: false` — 跳过此 hook，不触发任何 action

## 后端 API（CLI 化）

### `GET /api/hooks`
读取全局 `~/.pluse/hooks.json`，返回完整 HooksConfig。

```json
{ "ok": true, "data": { "hooks": [...] } }
```

### `PATCH /api/hooks/:id`
更新某个 hook 的字段（目前支持 `enabled`），写回 `~/.pluse/hooks.json`。

请求体：
```json
{ "enabled": false }
```

响应：更新后的完整 HooksConfig。

> 注意：只操作全局 hooks.json，项目级的不通过 API 管理（Agent 直接编辑文件）。

## 前端变更：设置页面加开关

在 `SettingsPage.tsx` 里新增一个 section "通知"，包含：

- **会话完成后创建待办**（开关）
  - 说明文字：「AI 完成一轮会话后，自动在待办列表创建提醒」
  - 对应 hook id：`notify-on-session-complete`
  - 读取：`GET /api/hooks` → 找到该 id 的 hook → 读 `enabled`
  - 写入：`PATCH /api/hooks/notify-on-session-complete` → `{ enabled: true/false }`

## 执行流程

```
用户切换开关
  ↓
PATCH /api/hooks/notify-on-session-complete { enabled: false }
  ↓
后端读取 ~/.pluse/hooks.json
  ↓
更新对应 hook 的 enabled 字段
  ↓
写回 ~/.pluse/hooks.json
  ↓
返回更新后的 config
```

hooks 执行时（`matchesFilter`）：
```
if (hook.enabled === false) return false  // 跳过
```

## 实现顺序

1. `hooks.ts` — `Hook` 接口加 `enabled?: boolean`，`matchesFilter` 检查 `enabled !== false`
2. `hooks.ts` — 导出 `loadGlobalHooksConfig`、`saveGlobalHooksConfig`、`patchHook`
3. `controllers/http/hooks.ts` — 新路由文件，`GET /api/hooks`、`PATCH /api/hooks/:id`
4. `server.ts` — 注册 `hooksRouter`
5. `SettingsPage.tsx` — 加"通知"section 和开关

## 决策记录

- API 只操作全局 hooks.json，不操作项目级
- `enabled` 默认为 true（不写等于开启）
- 文件不存在时，`GET /api/hooks` 返回内置默认配置（`notify-on-session-complete` enabled=true），开关显示开启状态
- `HooksConfig`/`Hook` 类型不放 `@pluse/types`，前端只定义简单接口 `{ id: string, enabled?: boolean }`，避免过度耦合
