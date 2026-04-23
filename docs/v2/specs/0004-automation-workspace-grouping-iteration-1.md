# 0004 — Automation Workspace Grouping Iteration 1

**状态**: draft
**类型**: spec
**关联 requirement**: `docs/v2/requirements/0004-ai-task-result-handling.md`
**关联 design**: `docs/v2/designs/0004-automation-result-attention.md`

## 本期目标

本期只做一个前端迭代：

- 去掉右侧工作面板的 `会话` scope
- 去掉右侧工作面板底部对象筛选里的 `全部`
- `全局待办` 先按 `项目` 分组
- 自动化不再进入 `已完成 / 已处理` 历史区
- 自动化按自身语义分组展示
- 自动化状态文案从“完成”改为“执行”
- 左侧 `领域` 视图默认展开领域组

## 本期范围

### 1. 工作面板 scope 收敛

顶部 scope 从：

- `全局 / 项目 / 会话`

收敛为：

- `全局 / 项目`

### 2. Todo 保留历史区

Todo 继续保留：

- `待办`
- `历史`
- `归档`

其中：

- `历史` 承接 `done / cancelled`
- `历史` 默认折叠
- 其他分组允许手动展开 / 收起

在 `全局 + 待办` 视图下：

- Todo 先按 `projectId` 分组
- 顶层先有一个默认折叠的 `历史`
- `历史` 展开后再显示按项目分的历史组
- 项目历史组默认也折叠
- 分组标题显示项目名
- 每个项目组内继续按既有待办排序规则显示

在 `项目 + 待办` 视图下，不额外引入项目分组。

### 3. Automation 改为分组区

Automation 不再进入统一历史区，而是按以下分组渲染：

1. `运行中`
2. `异常`
3. `周期`
4. `定时`
5. `手动`

自动化归档对象继续进入 `归档` 区。

### 4. Automation 状态文案

自动化状态映射为：

- `pending` -> `待触发`
- `running` -> `运行中`
- `done` -> `已执行`
- `failed` -> `失败`
- `cancelled` -> `已取消`

相关活动、详情、配置文案同步改口：

- `自动化完成` -> `运行完成`
- `完成后复盘` -> `运行后复盘`

### 5. 领域视图默认展开

`DomainSidebar` 中领域组默认展开，用户进入 `领域` 视图时可直接看到项目列表。

## 影响模块

- `packages/web/src/views/components/TodoPanel.tsx`
- `packages/web/src/views/components/TaskDetail.tsx`
- `packages/web/src/views/components/TaskComposerModal.tsx`
- `packages/web/src/views/pages/MainPage.tsx`
- `packages/web/src/i18n.tsx`

## 数据与接口边界

本期不改：

- database schema
- HTTP API
- CLI
- `Quest.status` 枚举

## 验收标准

1. 右侧工作面板不再出现 `会话` scope tab
2. 右侧工作面板底部对象筛选只保留 `待办 / 自动化`
3. `全局待办` 可以按项目分组显示
4. `全局待办` 的历史先折叠为一个顶层 `历史`
5. 顶层历史展开后，项目历史组默认仍不展开
6. 其他分组支持手动展开 / 收起
7. 自动化不再落入 `已处理` 或 `已完成` 历史区
8. 自动化可以按 `运行中 / 异常 / 周期 / 定时 / 手动` 分组显示
9. 自动化详情与列表里，`done` 不再显示为“已完成”，而显示为“已执行”
10. 左侧 `领域` 视图默认展开领域组
11. Todo 仍然保留 `已完成` 语义，不受自动化收敛影响
