# 0013 Project Domains

## 背景

当前 Pluse 以 `Project` 作为工作容器，Project 内再承载 `Quest / Todo / Run`。

这套模型适合单个项目推进，但当用户同时经营多个长期事项时，会出现两个问题：

- Project 列表是平铺的，缺少一个稳定的上层组织层
- 用户想用 Pluse 管理“人生中的不同板块”，但又不希望一开始就引入完整的人生目标系统

因此需要在 `Project` 之上增加一个轻量的上层对象，用来分组项目，但不侵入现有执行模型。

## 目标

为 `Project` 增加一个可选的上层组织对象 `Domain`。

`Domain` 在 v0 中只负责：

- 组织多个 Project
- 改善左侧导航与项目切换
- 为后续更完整的人生系统保留上层入口

`Domain` 在 v0 中不负责：

- 承载 Quest
- 承载 Todo
- 承载 Run
- 承载目标树、预算、指标、复盘引擎

## 核心决策

### 名称统一为 Domain

- 文档、数据、接口统一使用 `Domain`
- UI 中文可显示为“领域”

### Domain 是 Project 的上层，不改变 Project 的本质

- Project 仍然对应本地工作目录
- Quest / Todo / Run 仍然归属于 Project
- `codexThreadId` / `claudeSessionId` 仍然跟随 Quest，不受 Domain 影响

### v0 是组织层，不是人生控制层

v0 只解决“多个项目如何分组与切换”，不解决“人生目标如何计算与闭环”。

### 一个 Project 在 v0 中只能属于一个 Domain

- `project.domainId` 可空
- 未设置时归入“未分组”
- 暂不支持多 Domain、多主次领域、自动分类

### Domain 支持默认模板，但用户可完全自定义

首次使用时，系统可以提供一组默认模板，建议包括：

- 产品/事业
- 财富
- 能力
- 影响力
- 关系
- 健康
- 运营

这组模板只是起点：

- 用户可以跳过模板
- 用户可以修改名称
- 用户可以删除默认项
- 用户可以新建自定义 Domain

## 数据模型

### Domain

```ts
interface Domain {
  id: string
  name: string
  description?: string
  icon?: string
  color?: string
  orderIndex?: number
  deleted?: boolean
  deletedAt?: string
  createdAt: string
  updatedAt: string
}
```

### Project 增量字段

```ts
interface Project {
  // existing fields...
  domainId?: string
}
```

## 对象关系

```text
Domain (1)
  └── Project (n)
        ├── Quest (n)
        │     └── Run (n)
        └── Todo (n)
```

约束：

- Domain 只组织 Project，不直接承载 Quest/Todo/Run
- 删除/归档 Domain 时，不删除 Project
- 删除/归档 Domain 时，必须把其下所有 Project 的 `domainId` 清空
- Domain 被删除/归档后，原属 Project 自动回到“未分组”

## v0 UI 范围

### 左侧栏增加 Domain Tab

左侧栏顶部新增两个 tab：

- `会话`
- `Domain`

### 会话 Tab

- 保持当前行为不变
- 继续展示当前 Project 的 Session 列表
- 不增加 Domain 信息

### Domain Tab

展示当前用户/工作空间下的 Domain 分组视图：

- 顶部操作
  - 新建 Domain
  - 使用默认模板
- 列表内容
  - 全部项目
  - 未分组
  - 各个 Domain

默认只展示 active Project。
已归档 Project 继续遵循现有 Project 归档语义，不进入默认分组视图。
`全部项目` 作为总览入口，不要求和各个 Domain 分组重复展示同一 Project。
每个 Project 在 Domain 视图中只出现一次，优先归属其 Domain，其次进入未分组。

每个 Domain 项显示：

- 名称
- 包含的 Project 数量
- 折叠/展开状态

每个 Domain 下展示其 Project 列表。

### 折叠规则

- Domain 列表默认折叠
- 用户可手动展开查看其中 Project
- 未分组区也遵循相同折叠逻辑

### Project 交互

在 Domain Tab 中点击 Project：

- 切换到对应 Project
- 进入 `/projects/:id`

v0 不要求单独的 `/domains/:id` 页面。

## Project 创建与编辑

### 新建 Project

新建 Project 时允许顺手选择一个 Domain：

- 可选，不强制
- 默认值为空
- 若为空，则进入“未分组”

### 编辑 Project

在 Project 设置中允许：

- 指定 Domain
- 修改 Domain
- 移出 Domain，回到“未分组”

## 默认模板策略

### 首次进入 Domain Tab

若系统中还没有任何 Domain，可显示一个轻提示：

- 使用默认模板
- 自己创建

### 使用默认模板

系统一次性创建一组建议 Domain。

要求：

- 只在用户确认后创建
- 不自动强塞给已有用户
- 创建后仍允许任意修改
- 如果同名 Domain 已存在，则跳过重复创建

## 数据库变更

### 新增表

```sql
CREATE TABLE domains (
  id          TEXT PRIMARY KEY NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  icon        TEXT,
  color       TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  deleted     INTEGER NOT NULL DEFAULT 0,
  deleted_at  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
) STRICT;
```

### Project 表增加外键

```sql
ALTER TABLE projects ADD COLUMN domain_id TEXT REFERENCES domains(id);
```

### 建议索引

```sql
CREATE INDEX idx_domains_active
  ON domains (deleted, order_index, updated_at DESC);

CREATE INDEX idx_projects_domain
  ON projects (domain_id, updated_at DESC);
```

## API / CLI 边界

v0 建议增加：

- `domain list`
- `domain create`
- `domain update`
- `domain delete`
- `project update --domain-id <id>`
- `project update --clear-domain`

HTTP 层对应增加 Domain CRUD 与 Project 归属修改接口。

## 不做的事

v0 明确不做：

- Domain 级 Quest 列表
- Domain 级 Todo 面板
- Domain 级 Run 聚合分析
- Domain 级目标、预算、健康度、指标系统
- 一个 Project 属于多个 Domain
- AI 自动推荐或自动归类 Domain
- Domain 改变任何 Project 的 `workDir`
- Domain 改变 Quest 的 provider context 行为

## 验收标准

- 可以创建、编辑、归档 Domain
- Project 可以设置、变更或清空 `domainId`
- 没有 Domain 的 Project 会稳定显示在“未分组”
- 左侧栏存在 `会话 | Domain` 双 tab
- `Domain` tab 默认以折叠形式展示各分组
- 新建 Project 时可以顺手选择 Domain，但不强制
- 删除 Domain 后，其下 Project 不丢失，只回到“未分组”
- 现有 Quest / Todo / Run 行为保持不变

## 后续扩展方向

若 v0 验证成立，后续再评估：

- Domain Overview 页面
- Domain 级项目健康度聚合
- Domain 级复盘与节律
- Domain 与更高层人生系统的连接
