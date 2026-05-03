# 0005 — Quest 归档时关联注意力对象剪枝 Phase 1

**状态**: draft
**类型**: spec
**关联 requirement**: `docs/v2/requirements/0005-quest-lifecycle-linked-dependent-cleanup.md`
**关联 design**: `docs/v2/designs/0005-quest-lifecycle-linked-dependent-cleanup.md`

## 目标

实现一个足够小、但能立刻稳定当前生命周期语义的闭环：

- Quest 归档时，自动归档由该 Quest 派生的 system review Todo
- Quest 归档时，自动删除或关闭来源于该 Quest 的 Reminder
- 普通 Todo 保持不动
- 普通 Todo 的来源 Quest 已归档时，来源入口提示已归档，不再直接跳转
- Quest 恢复时，不自动恢复这些被剪枝的 review Todo
- Quest 恢复时，不自动恢复这些被剪枝的 Reminder

这不是通用 cleanup 框架，也不是 Todo 模型重构，而是 Quest 生命周期和 review 信号之间的最小闭环。

## 背景

当前 review Todo 的产生有两条路径：

1. `packages/server/src/runtime/session-runner.ts`
   - `ensureTaskReviewTodo(...)`
   - 面向 `task + reviewOnComplete`

2. `packages/server/src/services/hooks.ts`
   - `run_completed` hook 可创建带 `review` tag 的 Todo
   - 当前 session review 也走这条路径

这已经解决了“什么时候产生 review 信号”，但没有解决：

- Quest 归档后这些信号如何退出工作面
- Quest 归档后来源于它的 Reminder 如何退出提醒面
- 保留下来的普通 Todo 如果仍指向已归档 Quest，用户点击来源时如何避免进入无效上下文

当前问题是：

- Quest 已归档
- review Todo 仍然留在 Todo 面里
- 用户需要手工收拾本可自动收敛的系统噪音

## 本期范围

### 1. Quest 归档时归档 system review Todo

当 Quest 从未归档进入归档态时，系统应查找并归档满足以下条件的 Todo：

- `originQuestId === quest.id`
- `deleted === false`
- `createdBy === 'system'`
- `tags` 包含 `review`

如果存在多条历史遗留 review Todo，应全部归档。

### 2. Quest 归档时删除或关闭来源 Reminder

当 Quest 从未归档进入归档态时，系统应查找并删除或关闭满足以下条件的 Reminder：

- `originQuestId === quest.id`

如果存在多条同源 Reminder，应全部从当前提醒面移除。

当前 Reminder 模型还没有完整的 `dismissed` 状态时，本期可以继续使用 delete 语义；如果实现时已引入关闭状态，则优先关闭而不是物理删除。

### 3. 普通 Todo 保持不动

以下 Todo 不应被本次 cleanup 影响：

- `createdBy !== 'system'` 的 Todo
- `tags` 不包含 `review` 的 Todo
- 没有 `originQuestId === quest.id` 的 Todo
- 已经 `done` / `cancelled` 但尚未删除的 Todo
- 已经 `deleted === true` 的 Todo

### 4. 普通 Todo 来源指向已归档 Quest 时提示

如果普通 Todo 保留 `originQuestId`，但来源 Quest 已归档：

- Todo 本身继续保留
- Todo 来源入口不直接跳转到 Quest 详情
- UI 应提示“来源会话已归档”或等价文案

如果来源 Quest 未归档，来源入口继续按现有方式跳转。

### 5. Quest 恢复不自动恢复被剪枝的 review Todo 或 Reminder

当 Quest 从归档态恢复时：

- 不恢复此前被剪枝的 review Todo
- 不恢复此前被删除或关闭的 Reminder

恢复后的 Quest 若再次产生 review 信号或提醒，应走现有 run / hooks / user action 逻辑生成新的对象。

## 不在本期范围

以下内容明确不做：

- Project / Domain 级 cascade cleanup
- Run 历史清理
- Quest 恢复时的反向恢复机制
- Todo 新字段、新类型体系
- 通用 lifecycle policy engine
- 前端额外提示“这是系统自动剪枝的 Todo”
- 独立 Todo 的自动取消、归档或状态迁移
- Reminder 完整历史页

## 行为规则

### 1. 触发点

cleanup 只应在 Quest archive 成立时触发：

- `before.deleted === false`
- `input.deleted === true`
- `updated.deleted === true`

其他场景不触发：

- Quest 恢复
- Quest 移动项目
- Quest kind 切换
- Quest 普通字段更新

### 2. 执行层次

执行层次应为：

1. `Quest service`
   - 发现 Quest 进入归档态
   - 调用 Todo cleanup 能力
   - 调用 Reminder cleanup 能力

2. `Todo service`
   - 查找符合条件的 review Todo
   - 逐条归档并复用现有 effects

3. `Reminder service`
   - 查找符合条件的 Reminder
   - 逐条删除或关闭并复用现有 effects

### 3. 匹配规则

Phase 1 对 Todo 采用规则推断，不新增 schema：

- `projectId === quest.projectId`
- `originQuestId === quest.id`
- `createdBy === 'system'`
- `deleted === false`
- `tags` 中包含大小写不敏感的 `review`

说明：

- `originQuestId` 单独存在不足以表达 lifecycle ownership
- `review + system` 共同表达“这是派生 review 信号”

Reminder 匹配规则为：

- `originQuestId === quest.id`

说明：

- Reminder 本身就是注意力对象
- 来源 Quest 归档后，同源 Reminder 继续留在提醒池通常只会制造过期触达

### 4. effects 语义

每条被归档的 Todo 应继续走现有 Todo service 效果链，保持：

- ProjectActivity 记录
- SSE `todo_updated` / `todo_deleted` 事件
- Todo 列表刷新语义

每条被删除或关闭的 Reminder 应继续走现有 Reminder service 效果链，保持：

- ProjectActivity 记录
- SSE `reminder_deleted` 或 `reminder_updated` 事件
- Reminder 列表刷新语义

本期不引入新的 lifecycle cleanup event 类型。

### 5. Todo 来源入口语义

前端展示 Todo 来源入口时，需要能够判断来源 Quest 是否已归档。

行为应为：

- 来源 Quest 未归档：保留现有跳转
- 来源 Quest 已归档：阻止跳转，并提示“来源会话已归档”
- 来源 Quest 不存在或无法加载：提示“来源会话不可用”

这条规则只影响 `originQuestId` 的 UI 解释，不改变 Todo 的生命周期。

## 建议实现方式

### 方案方向

在 `packages/server/src/services/todos.ts` 增加共享 helper，例如：

- `archiveSystemReviewTodosForQuest(projectId, questId)`

它负责：

- 列出当前 Project 下未删除的 review Todo
- 过滤 `originQuestId === questId && createdBy === 'system'`
- 对命中的 Todo 逐条调用现有 `updateTodoWithEffects(id, { deleted: true })`

然后在 `packages/server/src/services/quests.ts` 的 Quest 归档分支中调用。

在 `packages/server/src/services/reminders.ts` 增加共享 helper，例如：

- `deleteRemindersForQuestWithEffects(projectId, questId)`

它负责：

- 列出当前 Project 下 `originQuestId === questId` 的 Reminder
- 对命中的 Reminder 逐条调用现有 `deleteReminderWithEffects(id)`
- 如果实现时已引入关闭状态，则改为调用关闭能力

### 为什么复用现有 `updateTodoWithEffects`

这样可以直接继承已有行为：

- activity 记录
- SSE 广播
- 统一的 soft delete 语义

避免再造一条 Todo 删除旁路。

### 为什么复用现有 `deleteReminderWithEffects`

当前 Reminder 已经用 delete 表达从提醒面移除。

本期先复用它，可以避免在 0005 范围内提前重构 Reminder 状态机；后续 `0012-check-in-reminders` 推进提醒关闭状态时，再把这里的 cleanup 语义迁移为关闭。

## 模块影响范围

预计至少涉及：

- `packages/server/src/services/quests.ts`
- `packages/server/src/services/todos.ts`
- `packages/server/src/services/reminders.ts`
- `packages/server/src/models/todo.ts`
- `packages/server/src/models/reminder.ts`
- `packages/server/src/__tests__/quest-todo-run.test.ts`
- `packages/web/src/views/components/TodoPanel.tsx`

本期不要求改动：

- `packages/server/src/services/hooks.ts`
- `packages/server/src/runtime/session-runner.ts`

因为它们继续只负责产生 review 信号，不负责 cleanup。

## 验收标准

本期完成后，应满足：

1. Quest 归档时，系统生成的 review Todo 会被自动归档
2. Quest 归档时，来源于该 Quest 的 Reminder 会从提醒面移除
3. 普通 Todo 即使带有 `originQuestId` 也不会被误归档
4. 人工创建的 `review` Todo 不会被误归档
5. 普通 Todo 指向已归档 Quest 时，来源入口提示已归档，不直接跳转
6. Quest 恢复时，先前被剪枝的 review Todo 不会自动恢复
7. Quest 恢复时，先前被删除或关闭的 Reminder 不会自动恢复
8. task review 路径与 session hook 路径生成的 review Todo 都能被同一规则收敛

## 测试矩阵

至少覆盖以下场景：

1. `session` Quest 通过 hook 生成 `system + review` Todo 后归档 Quest
   - review Todo 被归档

2. `task` Quest 通过 `reviewOnComplete` 生成 `system + review` Todo 后归档 Quest
   - review Todo 被归档

3. 存在 `originQuestId === quest.id` 的普通 Todo
   - Quest 归档后该 Todo 保持不动

4. 人工创建的 `tags=['review']` Todo
   - Quest 归档后该 Todo 保持不动

5. Quest 恢复
   - 先前被剪枝的 review Todo 不自动恢复

6. 历史遗留了多条同 Quest 的 system review Todo
   - Quest 归档后全部被归档

7. 存在多条 `originQuestId === quest.id` 的 Reminder
   - Quest 归档后全部从提醒面移除

8. 存在普通 Todo 指向已归档 Quest
   - Todo 保持 pending
   - 点击来源入口时提示来源会话已归档

9. 存在普通 Todo 指向未归档 Quest
   - 来源入口继续跳转 Quest 详情
