# 0003 — Agent 驱动的会话分类能力 Phase 1

**状态**: draft
**类型**: spec
**关联 requirement**: `docs/v2/requirements/0003-agent-driven-session-classification.md`
**关联 design**: `docs/v2/designs/0003-agent-driven-session-classification.md`

## 本期目标

Phase 1 只做最小可用的会话分类承接层，让 Agent 能对会话进行持久化分类，并让会话导航面消费这个结果。

本期目标不是做一套完整的人手动分组产品，而是先把：

- 分类对象
- 分类归属
- Agent 可调用能力
- 导航展示

这四件事打通。

## 策略边界

Phase 1 只定义分类能力的系统承接，不定义分类策略本身。

因此以下内容不在 core spec 中固化：

- 什么时候允许新建分类
- 什么时候应保持 `Uncategorized`
- 分类命名规范
- 什么时候应触发重分类

这些规则默认属于 Agent policy，后续可通过 hooks 或 prompt 配置承接。

需要明确的是：

- hooks 属于 Project 级生命周期控制面
- 本 spec 只是把会话分类接入这套控制面
- 后续若做任务分类，应复用同一套 hook / event 机制
- 但本期不把分类持久化模型提前泛化到 task
- `agent_classify_session` 必须后台异步执行，不阻塞当前 Run 完成

## 本期范围

### 1. 新增 `SessionCategory` 对象

系统新增一个 Project 作用域对象 `SessionCategory`，用于承接会话分类。

Phase 1 的 `SessionCategory` 只需要表达：

- 名称
- 可选描述
- 折叠状态
- 创建时间
- 更新时间

不要求颜色、图标、排序字段、归档能力。

### 2. Quest 支持可空的主分类归属

`Quest` 新增可空字段 `sessionCategoryId`。

行为：

- `kind='session'` 时会话导航面消费这个字段
- `kind='task'` 时保留该字段但不展示
- 空值表示 `Uncategorized`

### 3. 向 Agent 暴露分类能力

Phase 1 需要通过现有 HTTP / CLI 体系向 Agent 暴露：

- 列出当前 Project 的分类
- 创建分类
- 更新分类
- 删除分类
- 给 Quest 设定分类
- 清空 Quest 分类

### 4. 会话导航面按分类渲染

`SessionList` 改为支持以下结构：

1. `Pinned`
2. 按 `SessionCategory` 分区
3. `Uncategorized`
4. `Archived`

为避免重复展示：

- 已置顶会话不再重复出现在分类区和 `Uncategorized`

### 5. 最小的人类可见性

Phase 1 不要求完整的人工分类管理 UI，但至少要让用户在现有会话导航里看见分类结果。

### 6. 一次性的首轮分类 hook

Phase 1 可以把自动分类接入现有 hooks 体系，但只负责分类，不迁移现有自动命名链路。

推荐规则：

- 只对 `kind='session'` 生效
- 触发时机为首个有效 chat run 完成后
- 若 Quest 已有 `sessionCategoryId`，则默认跳过
- 第二轮及之后默认不再自动触发

Phase 1 的目的只是先把分类能力挂上现有生命周期，而不是同步重构自动命名。

## 不在本期范围

以下内容明确不做：

- 产品内置自动分类策略
- 后台常驻分类 worker
- 产品级分类门槛判断器
- 默认开启的持续重分类机制
- 多标签 / 多分类归属
- 人工拖拽整理
- 分类合并 / 智能去重
- 颜色 / 图标 / 封面等视觉增强
- 跨 Project 分类共享
- Task / Todo 分类
- 分类锁定、人工优先级覆盖等高级协作规则

## 数据模型

### 新增表：`session_categories`

```sql
CREATE TABLE session_categories (
  id            TEXT PRIMARY KEY NOT NULL,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  collapsed     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_session_categories_project_name
  ON session_categories (project_id, name);
```

### `quests` 表新增字段

```sql
ALTER TABLE quests ADD COLUMN session_category_id TEXT REFERENCES session_categories(id);
```

## 类型扩展

```ts
interface SessionCategory {
  id: string
  projectId: string
  name: string
  description?: string
  collapsed: boolean
  createdAt: string
  updatedAt: string
}

interface CreateSessionCategoryInput {
  projectId: string
  name: string
  description?: string
  collapsed?: boolean
}

interface UpdateSessionCategoryInput {
  name?: string | null
  description?: string | null
  collapsed?: boolean
}

interface Quest {
  ...
  sessionCategoryId?: string
}

interface UpdateQuestInput {
  ...
  sessionCategoryId?: string | null
}
```

## 行为规则

### 1. 项目作用域校验

`sessionCategoryId` 只有在以下条件满足时才可写入 Quest：

- category 存在
- category.projectId === quest.projectId

否则请求失败。

### 2. kind 切换

- `session -> task` 不清空 `sessionCategoryId`
- `task -> session` 恢复原分类展示

### 3. Quest 跨项目移动

`moveQuestWithEffects` 必须在事务中同步：

- 更新 `project_id`
- 清空 `session_category_id`
- 更新 runs 的 `project_id`

### 4. 删除分类

删除 `SessionCategory` 时必须在事务中先执行：

- `UPDATE quests SET session_category_id = NULL WHERE session_category_id = ?`

然后再删除分类记录。

Phase 1 删除分类采用直接删除，不做归档。

### 5. 归档会话

会话归档时保留 `sessionCategoryId`。

恢复后应回到原分类。

## HTTP 接口

### SessionCategory

```text
GET    /api/projects/:id/session-categories
POST   /api/projects/:id/session-categories
PATCH  /api/session-categories/:id
DELETE /api/session-categories/:id
```

### Quest patch 扩展

`PATCH /api/quests/:id`

支持：

```json
{
  "sessionCategoryId": "sc_..."
}
```

清空分类：

```json
{
  "sessionCategoryId": null
}
```

## Hooks 集成

如果接入 hooks，不建议产品定义一个行为名级别的专用 hook，例如：

- `session.classify`

更合理的做法是：

- 产品继续复用现有 hooks.json 的 `event + filter + actions` 骨架
- hook 在 Project 作用域内配置和执行
- 继续使用通用事件 `run_completed`
- 通过条件把执行范围限定到“首轮有效 session chat run 完成后”
- 会话分类作为该 hook 下的一条 Agent 策略执行

该 hook 的职责是：

- 在首轮有效 session run 完成后读取当前 Project 分类上下文
- 调用 Agent 做一次分类判断
- 再通过现有分类能力写回结果

推荐形态类似：

```json
{
  "id": "enrich-first-session-metadata",
  "enabled": true,
  "event": "run_completed",
  "filter": {
    "kind": "session",
    "trigger": ["chat"],
    "firstCompletedChatRun": true
  },
  "actions": [
    {
      "type": "agent_classify_session",
      "allowCreateSessionCategory": true
    }
  ]
}
```

这意味着 Phase 1 需要在 hooks 系统中新增两项能力：

1. filter 扩展
   - `trigger`
   - `firstCompletedChatRun`

2. 专用 action：`agent_classify_session`
   - 调用一次 Agent
   - 返回一次分类决策
   - 如有需要，创建或复用一个分类

推荐 action 形态：

```json
{
  "type": "agent_classify_session",
  "allowCreateSessionCategory": true
}
```

### `agent_classify_session` 执行模型

`agent_classify_session` 必须作为后台异步 action 执行。

要求：

- `finalizeRun()` 仍按现有语义先完成 Run 收尾
- hooks 命中后，分类任务在后台启动
- 不等待 Agent 分类完成再把 Run 标记为 completed
- 分类失败不影响当前 Run 终态
- Phase 1 不做自动重试

推荐行为：

1. hook 命中后启动后台分类任务
2. 分类任务读取最新 Quest 与当前 Project 分类上下文
3. 调用 Agent 生成结构化结果
4. 若需要，先创建或复用 `SessionCategory`
5. 再写回 `quest.sessionCategoryId`

为避免重复写入，写回前应再次读取 Quest，并至少检查：

- Quest 仍存在
- Quest 仍属于原 Project
- Quest 仍是 `kind='session'`
- Quest 还没有 `sessionCategoryId`

若任一条件不满足，则本次后台分类任务直接丢弃结果。

Agent 返回结果应受严格边界约束。推荐只允许以下四种模式：

- `noop`
- `assign`
- `create_or_reuse`
- `clear`

例如：

```json
{
  "mode": "assign",
  "sessionCategoryId": "sc_existing"
}
```

或：

```json
{
  "mode": "create_or_reuse",
  "name": "架构设计",
  "description": "讨论系统边界、数据模型与实现方案"
}
```

在 `create_or_reuse` 模式下：

- 若同名 `SessionCategory` 已存在，则复用
- 若不存在，则创建后再赋给 Quest

现有自动命名保持独立：

- 继续使用 `autoRenamePending`
- 继续由 `scheduleAutoRename()` / `maybeAutoRenameQuest()` 驱动
- 不在 Phase 1 与分类 hook 合并

Phase 1 不建议在 hook 中开放自动：

- rename category
- delete category
- merge category
- 持续 reclassify

## CLI 能力

所有命令继续支持 `--json`。

建议新增：

```text
pluse session-category list --project <projectId>
pluse session-category create --project <projectId> --name <name> [--description <text>]
pluse session-category update <id> [--name <name>] [--description <text>] [--collapsed true|false]
pluse session-category delete <id>
pluse quest update <questId> --session-category <categoryId>
pluse quest update <questId> --clear-session-category
```

这些命令的主要调用方是 Agent，而不是普通用户的日常手动操作。

## UI 范围

### SessionList

`SessionList` 需要：

- 额外拉取当前 Project 的 `sessionCategories`
- 先渲染 `Pinned`
- 再按 category 渲染 session 分区
- 再渲染 `Uncategorized`
- 最后渲染 archived 区

### 交互范围

Phase 1 不要求在 Web UI 中提供完整的：

- 新建分类
- 重命名分类
- 拖拽会话到分类

但允许后续在最小入口中补充轻量 override。

## 验收标准

- [ ] 系统存在独立的 `SessionCategory` 对象
- [ ] `Quest` 支持可空 `sessionCategoryId`
- [ ] Agent 可通过 HTTP / CLI 创建、更新、删除分类
- [ ] Agent 可通过 HTTP / CLI 为 Quest 设定和清空分类
- [ ] hooks 可基于 `run_completed` + `filter` 命中“首轮 session 元数据补全”
- [ ] hooks 支持 `agent_classify_session` action，并能完成一次后台分类回写
- [ ] `SessionList` 能按分类渲染会话
- [ ] 已置顶会话不在分类区重复出现
- [ ] Quest 切到 `task` 再切回 `session` 后原分类保留
- [ ] Quest 跨项目移动后 `sessionCategoryId` 被清空
- [ ] 删除分类不会删除会话，只会解绑会话

## 模块影响范围

预计至少涉及：

- `packages/types/src/quest.ts`
- `packages/types/src/index.ts`
- `packages/server/src/db/`
- `packages/server/src/models/quest.ts`
- `packages/server/src/models/`
- `packages/server/src/services/quests.ts`
- `packages/server/src/services/hooks.ts`
- `packages/server/src/controllers/http/`
- `packages/server/src/controllers/cli/`
- `packages/web/src/views/components/SessionList.tsx`

## 实施顺序建议

1. 先完成 schema migration 与 types 扩展
2. 再补 `SessionCategory` model / service / router / CLI
3. 再扩展 hooks filter 与 `agent_classify_session` action
4. 再补 Quest patch 与 move 语义
5. 最后让 `SessionList` 消费分类结果
