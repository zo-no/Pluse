# 0009 — Project Automation Panel Phase 1

**状态**: draft
**类型**: spec
**关联 requirement**:
- `docs/v2/requirements/0009-project-automation-closed-loop.md`
- `docs/v2/requirements/0004-ai-task-result-handling.md`

**关联 design**:
- `docs/v2/designs/0009-project-automation-closed-loop.md`
- `docs/v2/designs/0004-automation-result-attention.md`

## 本期目标

本期把自动化管理面板提升为项目页的独立 `自动化` tab，而不是继续挤在右侧工作台里。

判断依据：

- 自动化是项目闭环的一部分，需要在项目自己的管理视图里阅读和维护
- 自动化数量变多后，需要横向信息密度，右侧窄栏不适合承载完整管理
- 右侧工作台更适合只保留 `待办 / 提醒`，避免和项目自动化管理重复
- 项目页的 `overview.tasks` 已经返回当前项目全部未归档自动化，不需要新增后端接口

本期目标不是一次性做完整控制台，而是先让用户在单个项目内管理自动化：

- 看见本项目有哪些自动化
- 看见项目自动化健康状态
- 看见运行中、异常、周期、定时、手动分组
- 看见下一次运行时间或最近状态
- 新建、快速触发、暂停、恢复、归档自动化

本期不新增后端字段，不新增 API，不引入新的顶层路由。

## 当前问题

当前项目页已有项目概览，但自动化仍主要在右侧工作台中管理，存在几个问题：

1. 右侧栏空间窄，自动化多了之后只能堆叠列表
2. 用户在项目页无法直接判断该项目自动化是否健康
3. 自动化和项目目标、最近活动、等待事项之间缺少同屏关系
4. 自动化管理动作散在详情页和右侧栏，不利于日常维护
5. 右侧栏同时承载待办、提醒、自动化后，不适合继续升级成完整面板

## 本期范围

### 1. 项目页增加自动化 tab

在 `/projects/:id` 增加和 `概览 / 设置` 同级的 `自动化` tab。

位置：

- 项目 tab 顺序为 `概览 / 自动化 / 设置`
- `/projects/:id#automation` 直接打开 `自动化` tab

这样项目概览保持项目整体状态，自动化管理由独立 tab 承载。

### 2. 面板级摘要

面板顶部显示紧凑摘要：

- `自动化数`
- `运行中`
- `需要关注`
- `已暂停`

摘要只用于当前项目状态判断，不做趋势分析。

### 3. 健康状态

项目自动化面板显示一个健康状态文案。

映射：

| 条件 | 健康文案 | 样式 |
| --- | --- | --- |
| 存在 `status='failed'` 或 `status='cancelled'` | `需要关注` | attention |
| 存在 `activeRunId` 或 `status='running'` | `运行中` | running |
| 存在未来 `nextRunAt` | `已排程` | scheduled |
| 只有手动自动化 | `手动` | manual |
| 项目无自动化 | `未配置` | empty |

异常优先级高于运行中，因为用户需要先知道是否有需要处理的自动化。

### 4. 自动化分组

面板内按以下顺序分组：

1. `运行中`
2. `异常`
3. `周期`
4. `定时`
5. `手动`

分组只基于现有 Quest 字段：

- `Quest.status`
- `Quest.activeRunId`
- `Quest.enabled`
- `Quest.scheduleKind`
- `Quest.scheduleConfig`

### 5. 自动化行信息

每条自动化至少显示：

- 标题
- 当前执行状态
- 调度方式
- 下一次运行或最近运行时间
- 是否暂停
- 操作按钮

操作：

- 新建自动化
- 打开自动化详情
- 立即触发
- 暂停 / 恢复启用
- 归档

暂停 / 恢复复用现有 `api.updateQuest(quest.id, { enabled: false | true })`。

如果自动化正在运行，暂停或归档前先复用现有 `api.cancelRun` 流程取消当前执行。

### 6. 右侧工作台边界

右侧工作台只保留 `待办 / 提醒` tab。

自动化不再出现在右侧工作台，避免和项目自动化 tab 形成重复入口。

自动化的完整阅读和维护在项目页 `自动化` tab 完成。

## 影响模块

预计涉及：

- `packages/web/src/views/pages/MainPage.tsx`
- `packages/web/src/index.css`
- `packages/web/src/i18n.tsx`

可能涉及：

- `packages/web/src/views/components/TodoPanel.tsx`
  - 移除右侧工作台自动化 tab
- `packages/web/src/views/components/icons.tsx`
  - 如果缺少暂停图标，补充 `PauseIcon`

## 数据与接口边界

### 1. 不新增 schema

本期不新增：

- `surfacePolicy`
- `automationLevel`
- `attentionBudget`
- `lastSurfaceAt`
- 自动化分析统计字段

这些字段留到后续 spec。

### 2. 不新增 API

本期复用已有接口：

- `GET /api/projects/:id/overview`
- `POST /api/quests`
- `PATCH /api/quests/:id`
- `POST /api/quests/:id/run`
- `POST /api/runs/:id/cancel`

### 3. 不改变 Quest 语义

继续使用：

- `Quest.kind='task'`
- `Quest.status`
- `Quest.enabled`
- `Quest.scheduleKind`
- `Quest.scheduleConfig`
- `Quest.activeRunId`

## UI 结构

项目自动化 tab 结构：

```text
Project Automation Tab
  Panel Header
    title / health / new automation

  Summary Strip
    自动化数 / 运行中 / 需要关注 / 已暂停

  Automation Sections
    运行中
    异常
    周期
    定时
    手动
```

自动化行结构：

```text
Automation Row
  Title + status
  schedule kind + time
  actions: run / pause-resume / archive
```

## 文案规则

本期用户面统一使用：

- `自动化面板`
- `需要关注`
- `已排程`
- `已暂停`
- `暂停自动化`
- `恢复自动化`

不得使用：

- `AI 任务`
- `任务完成`
- `已处理自动化`

本期不出现尚未落地的数据概念：

- `透出策略`
- `提醒预算`
- `成熟度`
- `自动化等级`

## 不在本期范围

本期不做：

- 新的 `/automation` 全局页面
- 自动化成熟度 `L0-L4` 的字段和编辑 UI
- `surfacePolicy` 的字段和编辑 UI
- 项目提醒预算配置
- 自动化运行输出摘要抽取
- 自动化 run 历史抽屉
- 图表、趋势、分析统计

## 验收标准

1. 打开项目页后，可以看到 `概览 / 自动化 / 设置` 三个 tab
2. 打开 `/projects/:id#automation` 后，默认进入 `自动化` tab
3. 右侧工作台只显示 `待办 / 提醒`
4. 自动化 tab 展示当前项目全部未归档自动化
5. 面板顶部显示自动化数、运行中数、需要关注数、已暂停数
6. 面板能显示当前项目自动化健康状态
7. 自动化按 `运行中 / 异常 / 周期 / 定时 / 手动` 分组
8. 每条自动化可以打开详情
9. 每条自动化可以立即触发
10. 每条自动化可以暂停和恢复
11. 每条自动化可以归档
12. 自动化 tab 可以新建当前项目自动化
13. 不新增数据库字段
14. 不新增 API
15. 待办和提醒 tab 的行为不发生回归

## 建议实施顺序

1. 在 `MainPage.tsx` 中增加项目自动化摘要和分组函数
2. 在项目页增加 `自动化` tab，并在该 tab 渲染 `ProjectAutomationPanel`
3. 增加立即触发、暂停 / 恢复、归档 handler
4. 补充项目自动化面板 CSS
5. 补充 i18n 文案
6. 从右侧工作台移除自动化 tab
7. 运行 web build 和相关 typecheck
