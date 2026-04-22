# 0001 — Human Workload Control P0: Review Todo Uniqueness

**状态**: draft  
**类型**: spec  
**关联 requirement**: `docs/v2/requirements/0001-human-workload-control.md`  
**关联 design**: `docs/v2/designs/0001-human-workload-control.md`

## 目标

先做一刀足够小、但能立刻改善当前体验的修复：

- 同一个 Quest 在任意时刻最多只保留一条未完成的 `review` Todo
- 不再因为每次 run 完成就持续生成新的 review Todo

这不是完整的 Todo 重构，也不是新的待办语义系统，只是对当前 review 挂载行为做去重和收敛。

## 背景

当前仓库里已经有两条与 review Todo 相关的后处理路径：

1. `packages/server/src/runtime/session-runner.ts`
   - `ensureTaskReviewTodo(...)`
   - 面向 `task + reviewOnComplete`
   - 目前是硬编码的 run 收尾逻辑

2. `packages/server/src/services/hooks.ts`
   - 已存在显式 hooks 机制
   - 默认 `run_completed` hook 会对 `session` 创建带 `review` tag 的 Todo

这导致当前体验存在一个明显问题：

- 同一 Quest 多次运行后，会不断堆积新的 review Todo
- 用户需要手动收拾这些重复项
- review 信号被噪音淹没

## 本期范围

### 1. 统一目标行为

对于同一个 Quest：

- 如果不存在未完成的 review Todo
  - 当前 run 完成后允许创建一条新的 review Todo

- 如果已经存在未完成的 review Todo
  - 当前 run 完成后不再新建新的 review Todo
  - 可以选择跳过，或仅刷新现有项的上下文/时间戳

- 只有当这条 review Todo 被完成、取消或删除后
  - 后续新的 run 才允许再次生成新的 review Todo

这里的“未完成”至少包括：

- `pending`

这里的“已完成/已释放唯一性”至少包括：

- `done`
- `cancelled`
- `deleted`

### 2. 覆盖两条现有 review 生成路径

本期应同时覆盖：

- task 的 `reviewOnComplete`
- session 的 `run_completed -> create_todo(tags=['review'])` hook

目标不是只修其中一条，而是把“同 Quest 未完成 review Todo 唯一”作为统一规则。

### 3. 保持当前产品语义不变

本期不重新定义 review 是不是 Todo，也不引入新的 Todo 类型体系。

当前只做：

- review Todo 去重
- review Todo 唯一性约束

## 不在本期范围

以下内容明确不在本期范围：

- Todo 的 `do / provide / decide` 顶层分类
- notification / inbox / activity 与 Todo 的重新拆分
- 阻塞型人类请求机制
- Todo 展示大改
- 新的 hooks 插件系统或外部脚本平台
- run 完成后的其他后处理行为重构

## 关键设计判断

### 1. 这是架构内行为，不是外部脚本 patch

当前 review Todo 的生成本来就挂在：

- run 收尾逻辑
- 已有 hooks 机制

所以这次修复应继续留在 Pluse 自己的架构边界内完成，而不是作为临时脚本外挂。

### 2. 优先复用现有 hooks 和服务边界

当前仓库已经有：

- `run_completed` / `run_failed` hooks
- `createTodoWithEffects(...)`

因此本期应优先：

- 复用现有 hooks 机制
- 复用现有 Todo service
- 抽出一个“确保 review Todo 唯一”的共享逻辑

而不是引入一套新的事件系统。

### 3. 先保证唯一性，再讨论内容刷新

本期最核心的目标是：

- 不重复创建 review Todo

至于重复 run 到来时：

- 是完全跳过
- 还是轻量更新现有 Todo 的 `updatedAt` / `waitingInstructions`

都属于次级问题。

第一优先级是唯一性成立。

## 建议实现方式

### 方案方向

抽出一个共享 helper，例如：

- `ensureUniqueReviewTodo(...)`

由它负责：

- 根据 `projectId + originQuestId + review语义`
- 查找未完成的 review Todo
- 决定复用 / 跳过 / 新建

然后由两条路径共同调用：

1. `ensureTaskReviewTodo(...)`
2. `services/hooks.ts` 中的 `create_todo(tags=['review'])`

### 唯一性判断建议

第一版建议按以下条件判断是否属于“同一条 review Todo”：

- `originQuestId` 相同
- `deleted = false`
- `status = pending`
- `tags` 包含 `review`

这意味着第一版无需新增数据库字段，也无需新增唯一索引。

## 模块影响范围

预计主要涉及：

- `packages/server/src/runtime/session-runner.ts`
- `packages/server/src/services/hooks.ts`
- `packages/server/src/services/todos.ts`
- `packages/server/src/models/todo.ts`
- `packages/server/src/__tests__/quest-todo-run.test.ts`
- `packages/server/src/services/hooks.test.ts`

## 验收标准

本期完成后，应满足：

1. 同一个 Quest 连续多次 run 完成时，不会持续新增多条未完成 review Todo  
2. 只要该 Quest 已有一条未完成的 review Todo，新的 review 触发应被去重  
3. 当现有 review Todo 被完成、取消或删除后，后续新的 run 才允许生成下一条 review Todo  
4. task 路径与 session hook 路径都遵守同一唯一性规则  
5. 不需要修改当前前端展示，也能立刻改善 review Todo 泛滥问题

## 实施顺序建议

1. 先在 Todo service 层补出共享的 review 去重逻辑  
2. 再让 task review 路径调用这套逻辑  
3. 再让 session hooks 的 `create_todo(tags=['review'])` 调用同一套逻辑  
4. 最后补测试，覆盖：
   - task reviewOnComplete
   - session run_completed hook
   - review Todo 关闭后再次创建
