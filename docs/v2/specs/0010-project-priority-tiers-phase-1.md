# 0010 — Project Priority Tiers Phase 1

**状态**: draft
**类型**: spec
**关联 requirement**: `docs/v2/requirements/0010-project-priority-tiers-and-visibility.md`
**关联 design**: `docs/v2/designs/0010-project-priority-tiers-and-visibility.md`

## 本期目标

Phase 1 只做项目优先级体系的统一落地，完成以下闭环：

- 把项目优先级从 reminder 私有配置收敛到 Project 统一能力
- 在现有 `mainline / priority / normal` 基础上新增 `low`
- 让提醒分组与项目入口都使用同一套四档语义
- 让低优先项目默认折叠
- 让项目列表直接透出项目优先级

本期不做更复杂的注意力预算、自动推断和跨项目分析能力。

## 本期范围

### 1. 数据模型统一到 Project

为 Project 引入统一优先级字段，枚举为：

- `mainline`
- `priority`
- `normal`
- `low`

默认值为：

- `normal`

约束：

- `system` project 不参与该能力
- `archived` project 不参与 active 分组，但仍保留其优先级数据

### 2. reminder project priority 迁移与兼容

现有 `reminder_project_priorities` 中的数据迁移到 Project 统一优先级。

迁移规则：

- `mainline -> mainline`
- `priority -> priority`
- `normal` 或无记录 -> `normal`
- 新增档位 `low` 仅出现在新字段中

兼容策略：

- 本期允许 reminder 相关 API/CLI 暂时继续存在
- 但其读写应代理到 Project 统一优先级
- 不再保留 reminder 独立优先级真相源

### 3. 提醒分组支持 `low`

提醒 attention 排序与项目分组扩展为四档：

1. `mainline`
2. `priority`
3. `normal`
4. `low`

行为要求：

- `low` 项目组默认折叠
- 其他三档默认展开
- 同档内继续沿用现有 reminder attention 排序

### 4. 项目入口透出优先级

至少在一个主要项目入口直接透出项目优先级。

本期目标入口：

- 左侧项目切换器 / 项目列表

入口需要满足：

- 项目名旁可见优先级 badge 或标签
- 列表默认按优先级分层或排序
- 低优先项目默认折叠在单独分组中

### 5. 当前项目页透出优先级

至少在项目页 header 或同等级入口中显示当前项目优先级，使用户进入项目后仍能看到该项目层级。

### 6. 类型、API、CLI 口径统一

需要统一以下输出口径：

- `@pluse/types` 中的 `Project`
- `ProjectOverview.project`
- 项目列表接口返回值
- `project overview` CLI 输出
- reminder project priority 相关接口/命令的返回结构

本期允许保留旧命令名，但返回语义应明确已经是项目统一优先级。

## 数据与接口影响

### 数据模型

预计影响：

- `packages/types/src/project.ts`
- `packages/server/src/models/project.ts`
- `packages/server/src/db/index.ts`

预期方向：

- `Project` 新增 `priority`
- `CreateProjectInput` / `OpenProjectInput` / `UpdateProjectInput` 支持 priority

### 提醒相关类型

预计影响：

- `packages/types/src/reminder.ts`
- `packages/server/src/modules/reminders/project-priorities.ts`
- `packages/server/src/services/reminders.ts`
- `packages/server/src/controllers/http/reminders.ts`
- `packages/server/src/controllers/cli/reminder.ts`

预期方向：

- `ReminderProjectPriority` 扩展为四档，或直接被复用到统一 `ProjectPriority`
- reminder 项目优先级接口内部改为读写 Project priority

### 项目接口

预计影响：

- `packages/server/src/controllers/http/projects.ts`
- `packages/server/src/controllers/cli/project.ts`
- `packages/server/src/services/projects.ts`
- `packages/types/src/api.ts`

预期方向：

- 项目列表与 overview 返回统一 priority
- CLI 打印项目与 overview 时直接展示优先级

### 前端视图

预计影响：

- `packages/web/src/views/components/SessionList.tsx`
- `packages/web/src/views/components/TodoPanel.tsx`
- `packages/web/src/views/pages/MainPage.tsx`
- `packages/web/src/api/client.ts`
- `packages/web/src/index.css`
- `packages/web/src/i18n.tsx`

预期方向：

- 项目入口显示 badge / label
- 提醒项目分组加入 `low`
- 低优先分组默认折叠
- 当前项目页显示优先级

## 迁移要求

### 1. 数据迁移

数据库迁移需要完成：

- 为 `projects` 增加 priority 字段，默认 `normal`
- 将 `reminder_project_priorities` 已有值回填到 `projects.priority`

### 2. 行为迁移

迁移完成后：

- reminder attention 排序读取 `projects.priority`
- 项目入口读取 `projects.priority`
- 修改优先级时，提醒与项目入口应同步变化

### 3. 兼容要求

如果保留 `reminder_project_priorities` 表作为过渡：

- 它只能作为迁移来源或兼容壳
- 不能继续成为真实写入目标

如果本期直接移除旧表：

- 需要同步更新相关测试、CLI 命令和 API 实现

## 文案与交互规则

用户面统一文案：

- `主线`
- `优先`
- `普通`
- `低优先`

默认规则：

- `主线 / 优先 / 普通` 默认展开
- `低优先` 默认折叠

明确不使用：

- `暂停项目`
- `冷藏项目`
- `次要项目`

这些文案会模糊 `low` 与 `archived`、`disabled automation` 的边界。

## 验收标准

1. Project 拥有统一优先级字段，支持 `mainline / priority / normal / low`
2. 老的 reminder project priority 数据被迁移到 Project priority
3. 提醒 attention 排序与项目分组支持 `low`
4. 低优先 reminder 项目组默认折叠
5. 左侧至少一个主要项目入口直接显示项目优先级
6. 项目入口默认按优先级层级展示，低优先项目单独分组并默认折叠
7. 当前项目页能够直接看出该项目优先级
8. 项目优先级修改后，提醒视图和项目入口表现一致
9. CLI / API 返回的 Project 数据包含 priority
10. 不引入新的归档态，也不改变 `archived` 语义

## 不在本期范围

本期不做：

- 基于项目优先级的复杂筛选面板
- 自动根据项目行为推断优先级
- 不同优先级的通知预算
- 与自动化成熟度等级联动
- 多主线策略讨论
- 重新设计 Domain 信息架构

## 推荐实现顺序

1. 先完成类型与数据库迁移，把 Project priority 立为真相源
2. 再把 reminder priority 模块改成读取 Project priority，并补 `low`
3. 再更新项目列表 / 项目入口透出与默认折叠
4. 最后补 CLI、overview 输出和测试，锁定兼容行为

这个顺序的原因是：

- 真相源不统一，前端会继续绑定到旧 reminder 配置
- reminder 排序不切换，项目入口与提醒入口仍会漂移
- UI 先改而数据口径未收敛，会制造更多兼容负担
