# 0016 — 滚动式 Progress Cycle Phase 1

**状态**: draft
**类型**: spec
**关联 requirement**: `docs/v2/requirements/0016-rolling-progress-cycle.md`
**关联 design**: `docs/v2/designs/0016-rolling-progress-cycle.md`

## Summary

本期在保留 Todo-based Progress 的前提下，引入 Quest 级 `ProgressCycle`，把 Progress 从“单条长列表”升级成“按轮次推进的计划流”。

Phase 1 目标：

- Agent 每轮先创建 `3-5` 个中层阶段
- 每个 Progress item 归属某个 cycle
- 每完成一步都重新判断任务是否完成
- 当前 cycle 走完但任务未完成时，可开启下一轮 cycle
- 用户聊天可触发对 future items 的计划修正
- 前端按 cycle 分组展示全部 Progress

## Data / Types

### 新增 `ProgressCycle`

新增类型：

```ts
export interface ProgressCycle {
  id: string
  projectId: string
  questId: string
  status: 'active' | 'completed' | 'superseded' | 'cancelled'
  summary?: string
  createdAt: string
  updatedAt: string
  completedAt?: string
  supersededAt?: string
}
```

### 扩展 `Todo`

为 Progress item 增加可选归属：

```ts
progressCycleId?: string
```

仅 Quest Progress 条目使用此字段；普通 Todo 保持为空。

### Quest Progress API 返回结构升级

新增返回类型：

```ts
export interface QuestProgressCycleView {
  cycle: ProgressCycle
  items: Todo[]
}

export interface QuestProgressView {
  activeCycleId?: string
  cycles: QuestProgressCycleView[]
}
```

## Storage

### 新增表

`progress_cycles`

- `id`
- `project_id`
- `quest_id`
- `status`
- `summary`
- `created_at`
- `updated_at`
- `completed_at`
- `superseded_at`

### 扩展 `todos`

新增列：

- `progress_cycle_id TEXT NULL`

## Model / Service

### 新增 model

- `packages/server/src/models/progress-cycle.ts`

提供：

- `createProgressCycle`
- `getProgressCycle`
- `listProgressCyclesByQuest`
- `findActiveProgressCycleByQuest`
- `updateProgressCycle`

### 新增 service

- `packages/server/src/services/progress-cycles.ts`

提供：

- `ensureActiveProgressCycle`
- `completeProgressCycle`
- `supersedeProgressCycle`
- `buildQuestProgressView`
- `shouldOpenNextCycle`

## API

### 变更：`GET /api/quests/:id/progress`

返回从 `Todo[]` 升级为 `QuestProgressView`。

行为：

- 按 cycle 分组返回全部 Progress
- `active` cycle 排在最前
- 每个 cycle 内 items 按 `order ASC, created_at ASC`

### 新增：`POST /api/quests/:id/progress/cycles`

创建新 cycle。

主要由 CLI / Agent 使用，不向用户主流程暴露复杂 UI。

### 新增：`PATCH /api/progress-cycles/:id`

支持：

- `status`
- `summary`

## CLI

### 保持现有 item 入口

- `pluse progress list`
- `pluse progress create`
- `pluse progress update`
- `pluse progress wait`

### 新增 cycle 入口

```bash
pluse progress cycle list --quest-id <id> [--json]
pluse progress cycle create --quest-id <id> [--project-id <id>] [--summary <text>] [--json]
pluse progress cycle update <cycle-id> --status active|completed|superseded|cancelled [--summary <text>] [--json]
```

### Agent prompt 规则

更新 `services/system-prompt.ts`：

- 每次先 `progress list`
- 把一次任务推进视为一轮 progress 流程
- 无 active cycle 时先创建新 cycle
- 新 cycle 默认创建 `3-5` 个中层阶段
- 某些后台动作不必出现在 Progress 中；只保留用户可理解的阶段推进
- 微动作只写入 `active-form`
- 每个 item `done` 后都要判断：
  - 任务已完成 -> 停止并结束 cycle
  - 仍有 future item -> 继续当前 cycle
  - 当前 cycle 已走完且任务未完成 -> 开下一轮 cycle
- 用户聊天若表达计划调整，优先修正当前 cycle 的 future items
- 若任务进行中用户发来新消息改变方向，优先调整当前计划和执行路径
- 只有用户提出新的目标，或当前目标明显扩展到超出原计划时，才开启下一轮 progress 流程

## Runtime / Chat Revision

### Phase 1 规则

本期不做复杂 NLP 分类器。

对“聊天修正规划”的承接，先通过 prompt 约束 Agent：

- 用户要求调序 -> 重排 future items
- 用户要求补一步 -> 插入新 item
- 用户明显改向 -> 将当前 cycle 标 `superseded`，再建新 cycle

服务端不强制解释用户消息，只提供 cycle / item 的稳定承接能力。

## UI

### Progress 面板改为 cycle 分组

当前面板展示：

- 顶部显示当前 `active` cycle 摘要
- 下方展示当前 cycle items
- 历史 cycle 以分组形式展示，可折叠/展开

### 不隐藏历史

用户仍可查看全部 Progress 内容；本期只是将其重新组织为：

- 当前轮
- 历史已完成轮
- 被替换轮

## Migration / Compatibility

### 历史 Progress 的兼容策略

对于旧的 Quest Progress 条目：

- 不强制回填精确 cycle
- 在首次读取时可归入一个隐式 `legacy` cycle，或在迁移脚本中批量创建

### API 兼容

如果前端切换需要分步推进，可短期保留：

- `GET /api/quests/:id/progress?view=flat`

作为旧格式兼容出口。

## Acceptance

- [ ] Quest 同一时刻最多只有一个 `active` progress cycle
- [ ] Agent 可为 Quest 创建新 cycle，并在该 cycle 下创建 `3-5` 个 item
- [ ] Progress item 支持绑定 `progressCycleId`
- [ ] `GET /api/quests/:id/progress` 能按 cycle 返回全部 Progress
- [ ] 当前 cycle 走完但任务未完成时，可继续创建下一轮 cycle
- [ ] 当前 cycle 被计划改向时，可标为 `superseded`
- [ ] Prompt 明确要求使用中层阶段，而不是微动作
- [ ] Prompt 明确要求每个 item 完成后重新判断任务是否完成
- [ ] 前端 Progress 面板能按 cycle 分组展示全部内容

## 不做

- 自动识别所有聊天消息意图并强制修正规划
- 子步骤树状结构
- 多 Agent 共用同一 cycle
- 跨 Quest / 跨 Project 的 cycle 聚合
- 自动生成计划质量评分
