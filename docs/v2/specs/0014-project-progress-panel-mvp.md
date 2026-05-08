# 0014 — Project Progress Panel MVP

**状态**: accepted  
**类型**: spec  
**关联 requirement**: `docs/v2/requirements/0014-project-progress-panel.md`  
**关联 design**: `docs/v2/designs/0014-project-progress-panel.md`

---

## Summary

复刻 Claude Cowork 的 Progress 体验。Progress 不是独立的新概念——**它就是 Todo**，只是按 Quest（会话）粒度过滤、有序展示，并新增 `doing` 状态来反映 AI 执行中的实时步骤。

AI 在执行任务时，通过 CLI 命令主动创建和更新 Todo（`created_by = ai`，`origin_quest_id = <当前 Quest>`），这些条目在 Progress 面板中实时展示，形成任务执行的透明化视图。

人工创建的 Todo（`created_by = human`）如果绑定了 Quest，也会出现在该 Quest 的 Progress 面板中。

**本期实现范围：会话（Quest）粒度的 Progress。**

本期改动：

1. `TodoStatus` 新增 `doing`
2. `todos` 表新增 `order` 字段
3. Todo model 层支持按 `origin_quest_id` 查询并按 `order` 排序
4. `pluse progress` CLI 成为 Progress 一等入口，并保留 `pluse todo progress-*` 兼容别名
5. 注入 AI system prompt，AI 执行任务时自动写入 Progress
6. 前端：Quest 详情页新增 Progress 面板

---

## Data / Types

### TodoStatus 新增 `doing`

```typescript
// packages/types/src/todo.ts
export type TodoStatus = 'pending' | 'doing' | 'done' | 'cancelled'
```

### todos 表新增 `order` 字段

```sql
-- 通过 ensureColumn 向后兼容添加
ALTER TABLE todos ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0
```

### Todo 接口新增 `order` 字段

```typescript
export interface Todo {
  id: string
  projectId: string
  createdBy: TodoCreatedBy
  originQuestId?: string
  title: string
  description?: string
  waitingInstructions?: string
  dueAt?: string
  repeat: TodoRepeat
  priority: TodoPriority
  tags: string[]
  status: TodoStatus
  order: number          // 新增
  deleted?: boolean
  deletedAt?: string
  createdAt: string
  updatedAt: string
}

export interface CreateTodoInput {
  // ...existing fields...
  order?: number         // 新增
}

export interface UpdateTodoInput {
  // ...existing fields...
  status?: TodoStatus    // 已有，现在包含 doing
  order?: number         // 新增
}
```

---

## API

### 新增：`GET /api/quests/:questId/progress`

返回指定 Quest 下的所有 Todo（Progress 视图），按 `order ASC, created_at ASC` 排序，不包含已删除条目。

**Response**: `ApiResult<Todo[]>`

### 已有 API 的行为变更

`GET /api/todos?projectId=xxx` — 不变，返回项目维度所有 Todo

`POST /api/todos` — 支持传入 `order` 字段

`PATCH /api/todos/:id` — 支持更新 `status` 为 `doing`

---

## CLI

### 新增快捷命令（首选：`pluse progress`）

AI 执行任务时使用：

```bash
# 读取当前 Quest 已有 Progress，优先续写
pluse progress list --quest-id <id> [--json]

# 创建 Progress 条目（AI 专用，自动绑定当前 Quest）
pluse progress create --quest-id <id> [--project-id <id>] --title <title> [--active-form <text>] [--order <n>] [--json]

# 更新状态或执行中文案
pluse progress update <id> --status doing|done|pending [--active-form <text>] [--json]

# 需要等待人类输入时阻塞等待
pluse progress wait <id> [--timeout <seconds>] [--interval <ms>]
```

兼容保留的旧入口：
```bash
pluse todo progress-create --quest-id <id> --title <title> [--order <n>] [--json]
pluse todo progress-update <id> --status doing|done|pending [--json]
pluse todo progress-wait <id> [--timeout <seconds>] [--interval <ms>]
```

顶级 `progress` 是面向 Agent discoverability 的首选接口；`todo progress-*` 继续保留，避免破坏已有 prompt 和脚本。

### `pluse todo list` 新增过滤参数

```bash
pluse todo list --quest-id <id> [--json]   # 按 Quest 过滤（Progress 视图）
```

---

## System Prompt 注入

在 `services/system-prompt.ts` 构建 system prompt 时，追加以下内容：

```
## Pluse Plan

- 当任务不是纯问答且包含多个步骤时，先创建完整 progress，再开始执行。
- 开始执行前先读取已有 progress；有未完成项就续写，不要重复建计划。
- Progress 至少覆盖关键节点：分析 / 实现 / 验证。

pluse progress list --quest-id <QUEST_ID> --json
pluse progress create --quest-id <QUEST_ID> --project-id <PROJECT_ID> --title "<步骤描述>" --active-form "<执行中文案>"
pluse progress update <todo_xxx> --status doing
pluse progress update <todo_xxx> --status done
pluse progress wait <todo_xxx>
```

`QUEST_ID` 和 `PROJECT_ID` 由服务端在生成 system prompt 时直接内插当前 Quest / Project 的真实值，不依赖额外环境变量契约。

---

## UI

### Quest 详情页新增 Progress 面板

**位置**：Quest 对话界面的右侧或下方，与消息列表并列。

**展示内容**：

```
Progress

● 分析需求文档          ← doing（蓝色左边框 + 动画点）
  ✓ 读取 requirements 目录   ← done
  ✓ 理解用户意图             ← done
○ 起草设计方案          ← pending
○ 写 spec 文档          ← pending
```

**状态图标**：
- `○` pending（灰色）
- `●` doing（蓝色，可加脉冲动画）
- `✓` done（绿色）
- `—` cancelled（灰色删除线）

**交互规范**：
- 本期只读，不支持手动编辑
- 无数据时展示空状态："AI 执行任务时，进度将自动出现在这里"
- 当 Progress 面板以内嵌模式挂载到右侧 `ContextWorkbench` 时，应隐藏内部 tab 头，但仍正常渲染 Progress 内容区
- 轮询刷新：每 3 秒请求一次 `GET /api/quests/:id/progress`（Phase 2 改 SSE）

---

## Acceptance

- [ ] `TodoStatus` 包含 `doing`，类型编译通过
- [ ] `todos` 表有 `order` 字段，旧数据默认值为 0
- [ ] `pluse progress create --quest-id qst_xxx --title "分析需求"` 创建成功，`created_by = ai`
- [ ] `pluse progress update <id> --status doing` 更新成功
- [ ] `pluse progress list --quest-id qst_xxx` 返回该 Quest 下的 Todo，按 order 排序
- [ ] `pluse progress wait <id>` 对已完成条目立即返回
- [ ] 旧 `pluse todo progress-create|progress-update|progress-wait` 兼容入口继续可用
- [ ] `pluse todo list --quest-id qst_xxx` 返回该 Quest 下的 Todo，按 order 排序
- [ ] `GET /api/quests/:id/progress` 返回该 Quest 的 Todo 列表
- [ ] AI 执行任务时，Progress 面板中能看到实时更新的步骤
- [ ] Quest 详情页 Progress 面板正确展示，doing 状态有高亮
- [ ] 右侧 `ContextWorkbench` 以内嵌模式打开 `progress` tab 时，Progress 内容正常显示，不因隐藏内部 tab 而被一起屏蔽
- [ ] 无数据时展示空状态文案

---

## 不做（本期）

- SSE/WebSocket 实时推送（用轮询代替）
- 人工在 Progress 面板里手动添加/编辑条目
- Progress 条目的层级结构（父子关系）
- 项目维度的 Progress 聚合视图
- 破坏性操作保护（Deletion protection）
