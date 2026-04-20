# 0001 — Hooks 机制

## 背景

Quest 单轮执行完成后，人类需要知道"有事要看了"，而不是一直盯着屏幕。
这个行为（高亮、创建 Todo）应该可配置——Agent 可以根据任务性质自主写入 hook。

## 目标

- Agent / 人类可以在 hooks.json 里配置事件触发动作
- 第一批 action：`highlight_quest`（会话高亮）、`create_todo`（创建人类待办）
- 满足"单轮完成 → 高亮 + Human Todo"这个核心场景

## 配置文件

**两级加载，项目级优先：**
- 全局：`~/.pluse/hooks.json`（或 `$PLUSE_ROOT/hooks.json`）
- 项目级：`{project.workDir}/.pluse/hooks.json`

> `getProjectManifestDir(workDir)` 已有现成实现，返回 `{workDir}/.pluse`，直接复用。

```json
{
  "hooks": [
    {
      "id": "notify-on-session-complete",
      "enabled": true,
      "event": "run_completed",
      "filter": {
        "kind": "session",
        "triggeredBy": ["human"]
      },
      "actions": [
        { "type": "highlight_quest" },
        {
          "type": "create_todo",
          "title": "查看会话：{{quest.name}}"
        }
      ]
    }
  ]
}
```

- `enabled: true`（默认，可省略）— 正常执行
- `enabled: false` — 跳过此 hook，不触发任何 action

## 事件类型（仅实现需要的）

| 事件 | 触发时机 | 可用上下文 |
|------|---------|-----------|
| `run_completed` | `finalizeRun()` state=`completed` | `quest`, `run` |
| `run_failed` | `finalizeRun()` state=`failed` | `quest`, `run` |

> `cancelled` 不触发 hook（用户主动取消，不需要通知）。

## Filter 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `kind` | `'session' \| 'task'` | Quest 类型 |
| `triggeredBy` | `string[]` | `human`, `scheduler`, `api`, `cli` |

## Action 类型

### `highlight_quest`
Quest 列表中高亮该条目，用户打开后清除。

```json
{ "type": "highlight_quest" }
```

实现：Quest 表新增 `unread INTEGER NOT NULL DEFAULT 0`，前端据此渲染高亮。

### `create_todo`
自动创建人类待办，关联到当前 Quest。

```json
{
  "type": "create_todo",
  "title": "查看会话：{{quest.name}}"
}
```

模板变量：`{{quest.name}}`（session 用 `name`，task 用 `title`，实现时取 `quest.name ?? quest.title`）、`{{quest.id}}`、`{{run.id}}`

## 数据模型变更

**1. `packages/types/src/quest.ts`**
- `Quest` 接口加 `unread?: boolean`
- `UpdateQuestInput` 加 `unread?: boolean`

**2. `packages/server/src/db/index.ts`**
项目用 `ensureColumn()` 做向后兼容 migration，加：
```typescript
ensureColumn(db, 'quests', 'unread', 'ALTER TABLE quests ADD COLUMN unread INTEGER NOT NULL DEFAULT 0')
```

**3. `packages/server/src/models/quest.ts`**
- `QuestRow` 类型加 `unread: number`
- `rowToQuest()` 加 `unread: row.unread === 1 ? true : undefined`（同 `pinned` 的模式）
- `updateQuest()` 加 `if (input.unread !== undefined) setField('unread', input.unread ? 1 : 0)`

**4. `packages/server/src/controllers/http/quests.ts`**
- `QuestPatchSchema`（zod）加 `unread: z.boolean().optional()`

## 执行流程

```
finalizeRun(runId, state)
  ↓
（现有逻辑：updateRun、updateQuest、createQuestOp、autoRename、ensureTaskReviewTodo）
  ↓
emitRunUpdated()
emitQuestUpdated()
maybeStartNextFollowUp()
  ↓
queueMicrotask(() => {          ← 插在最末尾，所有现有逻辑完成后
  runHooks(event, { quest, run })
})
```

`runHooks` 内部：
1. 读取全局 hooks.json（`getPluseRoot()/hooks.json`）
2. 读取项目级 hooks.json（`getProjectManifestDir(project.workDir)/hooks.json`），项目级覆盖全局同 id 的 hook
3. 匹配 event + filter
4. 执行 actions：`highlight_quest` → `updateQuest({ unread: 1 })`，`create_todo` → `createTodoWithEffects(...)`

## 前端变更

1. Quest 卡片：`unread=true` 时显示高亮样式（左侧色条）
2. 打开 Quest 时清除高亮：在 Quest 详情页 mount 时 `PATCH /api/quests/:id { unread: false }`（统一在详情页处理，覆盖所有入口：SessionList Link、TodoPanel 跳转等）
3. ~~Todo 关联跳转~~：`TodoPanel.tsx` 已有实现，无需开发

## 实现状态（已完成）

- [x] 类型层：`Quest` + `UpdateQuestInput` 加 `unread?: boolean`
- [x] DB migration：`ensureColumn` 加 `quests.unread`
- [x] Model 层：`QuestRow`、`rowToQuest()`、`updateQuest()` 加 `unread`
- [x] HTTP 层：`QuestPatchSchema` 加 `unread`
- [x] `packages/server/src/services/hooks.ts`：加载 + 匹配 + 执行，导出 `loadGlobalHooksConfig`/`saveGlobalHooksConfig`/`patchHook`
- [x] `finalizeRun()` 最末尾插入 `queueMicrotask(() => runHooks(...))`
- [x] 前端高亮 UI（左侧色条）+ Quest 详情页 mount 时清除 unread
- [x] `enabled` 字段支持（见 0002）

## 决策记录

- 两级 hooks 都支持，项目级优先
- Agent 写入无权限控制（v1 阶段）
- `cancelled` 不触发 hook
- hooks 执行走 `queueMicrotask`，不阻塞 `finalizeRun` 同步流程
- `quest.name ?? quest.title` 统一处理 session/task 命名差异
- `enabled` 字段由 0002 引入，`enabled: false` 时跳过该 hook
