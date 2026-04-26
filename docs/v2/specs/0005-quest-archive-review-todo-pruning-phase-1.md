# 0005 — Quest 归档时 review Todo 剪枝 Phase 1

**状态**: draft
**类型**: spec
**关联 requirement**: `docs/v2/requirements/0005-quest-lifecycle-linked-dependent-cleanup.md`
**关联 design**: `docs/v2/designs/0005-quest-lifecycle-linked-dependent-cleanup.md`

## 目标

实现一个足够小、但能立刻稳定当前生命周期语义的闭环：

- Quest 归档时，自动归档由该 Quest 派生的 system review Todo
- 普通 Todo 保持不动
- Quest 恢复时，不自动恢复这些被剪枝的 review Todo

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

### 2. 普通 Todo 保持不动

以下 Todo 不应被本次 cleanup 影响：

- `createdBy !== 'system'` 的 Todo
- `tags` 不包含 `review` 的 Todo
- 没有 `originQuestId === quest.id` 的 Todo
- 已经 `done` / `cancelled` 但尚未删除的 Todo
- 已经 `deleted === true` 的 Todo

### 3. Quest 恢复不自动恢复被剪枝的 review Todo

当 Quest 从归档态恢复时：

- 不恢复此前被剪枝的 review Todo

恢复后的 Quest 若再次产生 review 信号，应走现有 run / hooks 逻辑生成新的 Todo。

## 不在本期范围

以下内容明确不做：

- Project / Domain 级 cascade cleanup
- Run 历史清理
- Quest 恢复时的反向恢复机制
- Todo 新字段、新类型体系
- 通用 lifecycle policy engine
- 前端额外提示“这是系统自动剪枝的 Todo”

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

2. `Todo service`
   - 查找符合条件的 review Todo
   - 逐条归档并复用现有 effects

### 3. 匹配规则

Phase 1 采用规则推断，不新增 schema：

- `projectId === quest.projectId`
- `originQuestId === quest.id`
- `createdBy === 'system'`
- `deleted === false`
- `tags` 中包含大小写不敏感的 `review`

说明：

- `originQuestId` 单独存在不足以表达 lifecycle ownership
- `review + system` 共同表达“这是派生 review 信号”

### 4. effects 语义

每条被归档的 Todo 应继续走现有 Todo service 效果链，保持：

- ProjectActivity 记录
- SSE `todo_updated` / `todo_deleted` 事件
- Todo 列表刷新语义

本期不引入新的 event 类型。

## 建议实现方式

### 方案方向

在 `packages/server/src/services/todos.ts` 增加共享 helper，例如：

- `archiveSystemReviewTodosForQuest(projectId, questId)`

它负责：

- 列出当前 Project 下未删除的 review Todo
- 过滤 `originQuestId === questId && createdBy === 'system'`
- 对命中的 Todo 逐条调用现有 `updateTodoWithEffects(id, { deleted: true })`

然后在 `packages/server/src/services/quests.ts` 的 Quest 归档分支中调用。

### 为什么复用现有 `updateTodoWithEffects`

这样可以直接继承已有行为：

- activity 记录
- SSE 广播
- 统一的 soft delete 语义

避免再造一条 Todo 删除旁路。

## 模块影响范围

预计至少涉及：

- `packages/server/src/services/quests.ts`
- `packages/server/src/services/todos.ts`
- `packages/server/src/models/todo.ts`
- `packages/server/src/__tests__/quest-todo-run.test.ts`

本期不要求改动：

- `packages/server/src/services/hooks.ts`
- `packages/server/src/runtime/session-runner.ts`

因为它们继续只负责产生 review 信号，不负责 cleanup。

## 验收标准

本期完成后，应满足：

1. Quest 归档时，系统生成的 review Todo 会被自动归档
2. 普通 Todo 即使带有 `originQuestId` 也不会被误归档
3. 人工创建的 `review` Todo 不会被误归档
4. Quest 恢复时，先前被剪枝的 review Todo 不会自动恢复
5. task review 路径与 session hook 路径生成的 review Todo 都能被同一规则收敛

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
