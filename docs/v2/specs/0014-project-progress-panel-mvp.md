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
4. `pluse todo` CLI 新增 Progress 相关快捷命令
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

### 新增快捷命令（基于现有 `pluse todo`）

AI 执行任务时使用：

```bash
# 创建 Progress 条目（AI 专用，自动绑定当前 Quest）
pluse todo progress-create --quest-id <id> --title <title> [--order <n>] [--json]

# 更新状态
pluse todo progress-update <id> --status doing|done|pending [--json]
```

等价于：
```bash
pluse todo create --project-id <id> --quest-id <id> --title <title> --created-by ai
pluse todo update <id> --status doing
```

`progress-create` 是语义化封装，减少 AI 调用时的参数复杂度。

### `pluse todo list` 新增过滤参数

```bash
pluse todo list --quest-id <id> [--json]   # 按 Quest 过滤（Progress 视图）
```

---

## System Prompt 注入

在 `services/system-prompt.ts` 构建 system prompt 时，追加以下内容：

```
## Progress Tracking

你在执行任务时，使用以下命令实时汇报进度。这让用户能看到你正在做什么。

**开始一个任务步骤时：**
pluse todo progress-create --quest-id <QUEST_ID> --title "<步骤描述>"
（输出 todo_xxx，记住这个 ID）

**开始执行这个步骤时：**
pluse todo progress-update <todo_xxx> --status doing

**完成这个步骤时：**
pluse todo progress-update <todo_xxx> --status done

**规范：**
- 步骤描述用中文，面向用户，简洁易懂（不要技术术语）
- 粒度由你自己判断，不要过细（不需要每个文件读写都汇报）
- 关键节点必须汇报：开始分析、开始写代码、遇到问题、完成
- QUEST_ID 从环境变量 PLUSE_QUEST_ID 读取（已自动注入）
```

`PLUSE_QUEST_ID` 在 `session-runner.ts` 启动子进程时通过环境变量注入。

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
- 轮询刷新：每 3 秒请求一次 `GET /api/quests/:id/progress`（Phase 2 改 SSE）

---

## Acceptance

- [ ] `TodoStatus` 包含 `doing`，类型编译通过
- [ ] `todos` 表有 `order` 字段，旧数据默认值为 0
- [ ] `pluse todo progress-create --quest-id qst_xxx --title "分析需求"` 创建成功，`created_by = ai`
- [ ] `pluse todo progress-update <id> --status doing` 更新成功
- [ ] `pluse todo list --quest-id qst_xxx` 返回该 Quest 下的 Todo，按 order 排序
- [ ] `GET /api/quests/:id/progress` 返回该 Quest 的 Todo 列表
- [ ] AI 执行任务时，Progress 面板中能看到实时更新的步骤
- [ ] Quest 详情页 Progress 面板正确展示，doing 状态有高亮
- [ ] 无数据时展示空状态文案

---

## 不做（本期）

- SSE/WebSocket 实时推送（用轮询代替）
- 人工在 Progress 面板里手动添加/编辑条目
- Progress 条目的层级结构（父子关系）
- 项目维度的 Progress 聚合视图
- 破坏性操作保护（Deletion protection）
