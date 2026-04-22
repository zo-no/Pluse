# 0007 - 会话分组与项目分组

**状态**: draft  
**类型**: feature  
**优先级**: high  
**依赖**: `docs/mvp/architecture/architecture.md`, `docs/mvp/architecture/ui-design.md`, `docs/mvp/specs/core/0003-thread-unified-model.md`

> 这是旧草稿，保留作历史参考。
> 其中 Project 上层组织已由 `0008-domain-project-grouping.md` 替代。
> 其中会话侧方案已在 v2 转向 “Agent 驱动的会话分类能力”，见：
> - `docs/v2/requirements/0003-agent-driven-session-classification.md`
> - `docs/v2/designs/0003-agent-driven-session-classification.md`
> - `docs/v2/specs/0003-agent-driven-session-classification-phase-1.md`

---

## 背景

当前 Pluse 已有：

- `Project` 的归档、置顶、可见性
- `Quest(kind='session')` 的置顶、搜索、归档
- UI 层的时间分区与折叠区

但还没有用户可维护的对象级分组能力，导致两个问题：

1. 项目越来越多后，项目切换器只有平铺列表，缺少长期信息架构。
2. 会话越来越多后，左侧栏只有 `固定 / 最近 / 已归档`，无法按主题、阶段、来源组织。

本 spec 定义两类新能力：

- **项目分组**：给 `Project` 提供跨项目分组
- **会话分组**：给 `Quest(kind='session')` 提供项目内分组

本次不扩展到：

- Task 分组
- Todo 分组
- 多级分组
- 智能自动分类

---

## 目标

1. 让用户可以显式创建、命名、排序、折叠分组。
2. 保持现有 `Project -> Quest -> Run / Todo` 主模型不变，不引入新的核心容器。
3. 不破坏 Quest 的 `kind` 切换、归档、跨项目移动、provider context 保留规则。
4. API 和数据模型要支持后续扩展到 task 分组，但本期 UI 只开放项目和会话。

## 非目标

1. 不做树形文件夹。
2. 不做跨项目会话分组。
3. 不做一个“大一统 group 表”承载所有实体。
4. 不改变归档语义，分组不是归档替代品。

---

## 设计结论

### 1. 分成两套分组对象

使用两张表：

- `project_groups`
- `session_groups`

而不是抽象成单表 `groups(scope_type, entity_type, ...)`。

原因：

1. **作用域不同**：项目分组是全局工作台级；会话分组是单项目内。
2. **约束不同**：项目分组关联 `projects`，会话分组关联 `quests(kind='session')`。
3. **实现更直接**：当前代码和 schema 都是显式字段风格，避免过早引入多态约束。
4. **迁移风险更低**：现有 `move quest across project`、`kind switch` 行为更容易做精确处理。

### 2. 分组 membership 放在实体上

- `projects.project_group_id`
- `quests.session_group_id`

不单独建 membership 表。

原因：

1. 当前需求是单选分组，不是多标签。
2. 查询列表时更高频，直接 join 最简单。
3. 当前排序已经是实体列表排序，membership 表只会增加维护成本。

### 3. 会话分组只对 `kind='session'` 生效，但 membership 保留

`quests.session_group_id` 可以保留在 Quest 上，即使 Quest 临时切成 `kind='task'`。

这样：

- `session -> task` 时不丢失原分组
- `task -> session` 时自动恢复到原会话分组

这和现有“task 配置保留、provider context 保留”的方向一致。

---

## 数据模型

### 新增表：`project_groups`

```sql
CREATE TABLE project_groups (
  id            TEXT PRIMARY KEY NOT NULL,
  name          TEXT NOT NULL,
  color         TEXT,
  order_index   INTEGER,
  collapsed     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
) STRICT;

CREATE INDEX idx_project_groups_order
  ON project_groups (order_index, updated_at DESC);
```

说明：

- `collapsed` 是用户 UI 偏好，先按单用户本地工作台处理。
- `color` 仅作轻量视觉辅助，不作为业务语义。
- 未分组项目不强制进入默认组，通过 UI 展示“未分组”虚拟分区。

### `projects` 表新增字段

```sql
ALTER TABLE projects ADD COLUMN project_group_id TEXT REFERENCES project_groups(id);
```

### 新增表：`session_groups`

```sql
CREATE TABLE session_groups (
  id            TEXT PRIMARY KEY NOT NULL,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  color         TEXT,
  order_index   INTEGER,
  collapsed     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
) STRICT;

CREATE INDEX idx_session_groups_project_order
  ON session_groups (project_id, order_index, updated_at DESC);

CREATE UNIQUE INDEX idx_session_groups_project_name
  ON session_groups (project_id, name);
```

### `quests` 表新增字段

```sql
ALTER TABLE quests ADD COLUMN session_group_id TEXT REFERENCES session_groups(id);
```

---

## 类型定义

### ProjectGroup

```ts
interface ProjectGroup {
  id: string
  name: string
  color?: string
  order: number
  collapsed: boolean
  createdAt: string
  updatedAt: string
}
```

### SessionGroup

```ts
interface SessionGroup {
  id: string
  projectId: string
  name: string
  color?: string
  order: number
  collapsed: boolean
  createdAt: string
  updatedAt: string
}
```

### 扩展实体

```ts
interface Project {
  ...
  projectGroupId?: string
}

interface Quest {
  ...
  sessionGroupId?: string
}
```

---

## 核心行为

### 项目分组

1. 一个项目最多属于一个项目分组。
2. `archived=true` 的项目仍保留 `projectGroupId`。
3. 删除项目分组时，组内项目变为未分组，不删除项目。
4. 删除项目分组前，服务层需要先批量把 `projects.project_group_id` 置空，再删除 group 记录，不能把行为完全依赖给外键。
5. 置顶优先级仍高于分组内普通排序，但只在组内生效。

### 会话分组

1. 一个会话最多属于一个会话分组。
2. 只有当前项目内的 session group 才能被引用。
3. `Quest.kind='task'` 时不在左侧会话列表展示，但 `sessionGroupId` 保留。
4. `sessionGroupId` 必须属于 `quest.projectId` 对应项目；该约束在服务层校验，不依赖 SQLite 外键单独完成。
5. Quest 跨项目移动时，必须清空 `sessionGroupId`，避免残留到目标项目中的无效引用。
6. 会话归档时保留 `sessionGroupId`，恢复后回到原组。
7. 删除会话分组时，组内会话变为未分组，不归档、不删除；删除前服务层先批量清空 `quests.session_group_id`。

---

## API 方案

### 项目分组接口

```text
GET    /api/project-groups
POST   /api/project-groups
PATCH  /api/project-groups/:id
DELETE /api/project-groups/:id
POST   /api/project-groups/reorder
```

### 会话分组接口

```text
GET    /api/projects/:id/session-groups
POST   /api/projects/:id/session-groups
PATCH  /api/session-groups/:id
DELETE /api/session-groups/:id
POST   /api/projects/:id/session-groups/reorder
```

### 现有实体 patch 扩展

`PATCH /api/projects/:id`

```json
{
  "projectGroupId": "pg_..."
}
```

`PATCH /api/quests/:id`

```json
{
  "sessionGroupId": "sg_..."
}
```

### 返回策略

本期不强制把 group 对象内联到 `Project` / `Quest`，维持扁平返回：

- 实体只返回 `projectGroupId` / `sessionGroupId`
- UI 按需单独拉 group 列表并组装

这样能减少现有接口改造面，并保持模型层清晰。

---

## 排序与展示

### 项目切换器

项目列表从“单平铺”调整为：

1. `置顶`
2. 各项目分组
3. `未分组`
4. `已归档`

分组内排序：

1. `pinned DESC`
2. `updatedAt DESC`

未分组也是一个虚拟分区，不入库。

### 会话左侧栏

当前 `固定 / 最近 / 已归档` 需要升级为：

1. `固定`
2. 各会话分组
3. `未分组`
4. `最近`
5. `已归档`

说明：

- `固定` 仍然是跨组的快捷区，不改变用户现有心智。
- “最近”只收纳未固定且未显式分组的 session，避免同一会话重复出现。
- 会话已在显式分组内时，不再额外出现在“最近”。

这能兼容老用户现有使用方式，同时让新分组逐步接管长期组织。

---

## UI 交互

### 项目分组

项目切换器支持：

- 新建分组
- 重命名分组
- 调整分组顺序
- 折叠/展开
- 将项目移入某分组
- 将项目移出分组

建议不做拖拽作为第一期必选，优先用菜单式“移动到分组”与“上移/下移”。

### 会话分组

左侧栏支持：

- 新建会话分组
- 将当前会话移入分组
- 将当前会话移出分组
- 重命名分组
- 调整分组顺序
- 折叠/展开

建议入口：

1. 会话行的右键菜单或更多菜单
2. 分组标题行的更多菜单
3. Quest 详情页头部的“移动到分组”

---

## 迁移与兼容

### 数据迁移

1. 新建 `project_groups`
2. 给 `projects` 增加 `project_group_id`
3. 新建 `session_groups`
4. 给 `quests` 增加 `session_group_id`
5. 现有项目、会话默认都为 `NULL`

### 兼容策略

1. 老数据不需要回填。
2. UI 在 group 列表为空时，表现应尽量接近现在。
3. 所有 group 字段都允许为空，避免发布期阻塞现有创建/切换流程。

---

## 实现顺序

### Phase 1: 数据与接口

1. schema migration
2. `@pluse/types` 扩展
3. `models/project-group.ts` 与 `models/session-group.ts`
4. HTTP router
5. CLI 命令，继续支持 `--json`

### Phase 2: 项目分组 UI

1. 项目切换器按组渲染
2. 项目菜单支持移组
3. 分组 CRUD 与折叠

### Phase 3: 会话分组 UI

1. `SessionList` 按组渲染
2. Quest 菜单支持移组
3. Quest 详情补“移动到分组”

### Phase 4: 细化

1. reorder 体验
2. SSE 精准刷新
3. 空态与引导文案

---

## 风险与决策点

### 1. `最近` 与显式分组是否并存

建议：

- 保留 `最近`
- 但只显示“未显式分组且未固定”的会话

原因是直接删除“最近”会让当前侧边栏使用习惯断裂太大。

### 2. `Quest.kind` 切换如何处理 `sessionGroupId`

建议：

- 不清空
- `kind='task'` 时仅不展示

否则 `session -> task -> session` 会产生不必要的信息丢失。

### 3. Quest 跨项目移动如何处理 session group

建议：

- 直接清空 `sessionGroupId`

不要做“按名字自动匹配目标组”，因为这是隐式魔法，容易误归类。

### 4. 是否首期支持拖拽

建议：

- 不作为首期前置

当前代码还没有成熟的分组与重排抽象，先把模型边界做稳更重要。

---

## 验收标准

### 数据与接口

- [ ] `Project` 支持可空 `projectGroupId`
- [ ] `Quest` 支持可空 `sessionGroupId`
- [ ] 可独立 CRUD 项目分组与会话分组
- [ ] 删除分组不会删除组内实体，只会清空 membership

### 项目分组

- [ ] 项目切换器按 `置顶 / 分组 / 未分组 / 已归档` 展示
- [ ] 项目可以移入、移出分组
- [ ] 分组可折叠、重命名、排序

### 会话分组

- [ ] 会话侧栏按 `固定 / 分组 / 未分组 / 最近 / 已归档` 展示
- [ ] 会话可以移入、移出分组
- [ ] 分组可折叠、重命名、排序
- [ ] `session -> task -> session` 后原分组仍可恢复
- [ ] Quest 跨项目移动后若分组无效会自动清空

### 稳定性

- [ ] 不影响现有归档、置顶、搜索、follow-up queue、run 执行逻辑
- [ ] 无分组数据时，列表行为与当前版本基本一致
