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

- 把 Progress 当作当前 Quest 的执行计划，而不是汇报面板。
- 信息降噪优先：Progress 用来表达用户关心的阶段推进，不要把自然收尾、普通总结或低价值确认变成新的 Todo / Progress。
- 满足任一条件就先创建完整 progress，再开始执行：
  - 需要 3 个及以上明确动作
  - 涉及代码修改、文件操作、工具调用、信息收集后整合输出
  - 用户希望 AI 完成一件有始有终的事情，而不是纯问答
- 开始执行前先读取已有 progress；有未完成项就续写，不要重复建计划。
- 没有计划时，先创建 2-4 个中层阶段；大型任务最多 5 个，避免一开始拆成大量“待开始”条目。
- Progress 至少覆盖关键节点：分析 / 实现 / 验证。
- Progress 条目只记录用户可理解的阶段目标，不记录搜索、读文件、改单个函数、运行单条命令这类微动作。
- 当前阶段可以更具体，后续阶段保持较粗；随着执行推进再细化未来阶段，不要一开始拆成很多碎步骤。
- 微动作只能写进 `active-form`，不要拆成独立 progress 条目。
- 每次只允许一个步骤处于 doing。
- 每个实现类步骤后都必须有验证步骤。
- 自然完成时默认只更新现有 progress 并回复用户；只有后续人工动作明确、必要、可执行时，才追加 Todo / waiting progress / Reminder / Check-in。
- 只有缺少凭证、关键产品决策、或必须人工完成的外部操作时，才创建 waiting progress 并暂停。

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

**信息表达原则**：
- 默认状态优先靠时间线节点和颜色表达，不重复加同义文案
- `done` 项以绿色勾选和进度条表达完成，不再额外用“已完成”文字二次强调
- 顶部摘要只表达当前可感知状态，不把 pending 总数渲染成“X 项待开始”这类干扰性文案
- 仅 `doing` / `waiting` / `cancelled` 这类需要用户注意的特殊状态显示显式状态标签
- 默认由 AI 创建的条目不需要在每行重复标记来源；仅人工或系统来源在必要时补充说明

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
