# 0001 — Hooks 机制

## 背景

Quest 单轮执行完成后，人类需要知道"有事要看了"。但这个行为（高亮、创建 Todo、发通知）不应该硬编码，而应该是可配置的——Agent 自己可以根据任务性质决定注册什么 hook。

参考 Claude Code 的 hooks 设计：事件触发 → 执行预定义动作。

## 目标

- Agent 可以在执行过程中自主写入 hooks 配置
- 人类可以在 `.pluse/hooks.json` 里手动配置
- 第一批 action：`highlight_quest`（会话高亮）、`create_todo`（创建人类待办）

## 配置文件

位置：`.pluse/hooks.json`（项目级，跟随项目，可被 Agent 读写）

```json
{
  "hooks": [
    {
      "id": "notify-on-session-complete",
      "event": "run_completed",
      "filter": {
        "kind": "session",
        "triggeredBy": ["human"]
      },
      "actions": [
        { "type": "highlight_quest" },
        {
          "type": "create_todo",
          "title": "查看会话：{{quest.name}}",
          "description": "单轮执行完成，请查看结果。"
        }
      ]
    }
  ]
}
```

## 事件类型（Events）

| 事件 | 触发时机 | 可用上下文 |
|------|---------|-----------|
| `run_completed` | `finalizeRun()` 执行完成时 | `quest`, `run`, `project` |
| `run_failed` | `finalizeRun()` 执行失败时 | `quest`, `run`, `error` |
| `quest_created` | `createQuestWithEffects()` 时 | `quest`, `project` |
| `todo_completed` | Todo 标记为 done 时 | `todo`, `quest?` |

## Filter 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `kind` | `'session' \| 'task'` | Quest 类型 |
| `triggeredBy` | `string[]` | `human`, `scheduler`, `api`, `cli` |
| `projectId` | `string` | 限定特定项目 |
| `questId` | `string` | 限定特定 Quest |

## Action 类型（Actions）

### `highlight_quest`
在会话列表中高亮该 Quest，直到用户打开它。

```json
{ "type": "highlight_quest" }
```

实现：Quest 表新增 `unread: boolean` 字段，前端根据此字段渲染高亮样式。用户打开 Quest 时清除。

### `create_todo`
自动创建一个人类待办，关联到当前 Quest。

```json
{
  "type": "create_todo",
  "title": "查看会话：{{quest.name}}",
  "description": "可选描述，支持模板变量"
}
```

支持的模板变量：`{{quest.name}}`、`{{quest.id}}`、`{{project.name}}`、`{{run.id}}`

### `emit_event`（预留）
向 SSE 推送自定义事件，供外部系统订阅。

```json
{
  "type": "emit_event",
  "eventType": "custom_event_name",
  "payload": {}
}
```

## 数据模型变更

### Quest 表新增字段
```sql
ALTER TABLE quests ADD COLUMN unread INTEGER NOT NULL DEFAULT 0;
```

### hooks.json 不存 DB
配置文件走文件系统，不入库。原因：
- Agent 可以直接读写文件，不需要 API
- 版本可控（可以 git 追踪）
- 与 Claude Code 风格一致

## 执行流程

```
finalizeRun()
  ↓
loadHooks('.pluse/hooks.json')
  ↓
matchHooks(event='run_completed', context={quest, run})
  ↓
for each matched hook:
  executeActions(hook.actions, context)
    ├─ highlight_quest → updateQuest({ unread: true })
    └─ create_todo → createTodoWithEffects({ originQuestId, title })
```

## 前端变更

1. **会话列表高亮**：Quest 卡片在 `unread=true` 时显示高亮样式（左侧色条或背景色）
2. **进入会话清除高亮**：打开 Quest 时 PATCH `/api/quests/:id` 设置 `unread: false`
3. **Todo 关联跳转**：Todo 列表中的 `originQuestId` 可点击跳转到对应会话

## 实现顺序

1. DB migration：`quests.unread` 字段
2. hooks 加载器：读取 `.pluse/hooks.json`，在 `finalizeRun()` 中调用
3. action 执行器：`highlight_quest` + `create_todo`
4. 前端高亮 UI
5. 进入 Quest 时清除 unread
6. 默认 hooks.json：项目初始化时写入示例配置

## 待讨论

- [ ] hooks.json 是项目级（`.pluse/hooks.json`）还是全局级（`~/.pluse/hooks.json`）？还是两级都支持？
- [ ] Agent 写入 hooks 时是否需要权限控制？
