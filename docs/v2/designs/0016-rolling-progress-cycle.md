# 0016 — 滚动式 Progress Cycle 与聊天修正规划 — Design

**状态**: draft
**类型**: design
**关联 requirement**: `docs/v2/requirements/0016-rolling-progress-cycle.md`

## 设计目标

把 Quest 级 Progress 从“单条步骤流”升级为“滚动式 Progress Cycle”。

这个设计要解决的不是“如何隐藏 Progress 细节”，而是：

- 让 Agent 默认用中层粒度规划任务
- 让计划具备一轮一轮推进的生命周期
- 让用户聊天中的计划修正有稳定承接
- 让每一步完成后都触发一次任务完成判断

## 能力边界

### 本设计解决的问题

- Quest 级 Progress 的轮次语义
- Agent 创建 Progress 时的默认粒度和长程规划方式
- 聊天消息对当前 / 后续计划的修正承接
- Progress 与“任务是否完成”的判断连接

### 不在边界内

- 更换底层 Todo 载体为独立 ProgressItem 表
- 多 Agent 协同计划
- 跨 Quest 统一计划管理
- 自动根据代码图谱推导最优计划

## 核心对象

### 1. ProgressCycle

ProgressCycle 表示一次“规划一轮、执行一轮”的任务推进周期。

建议字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | cycle_xxx |
| questId | string | 归属 Quest |
| projectId | string | 归属 Project |
| status | enum | `active` / `completed` / `superseded` / `cancelled` |
| summary | string? | 本轮目标的简短摘要 |
| createdAt | timestamp | |
| updatedAt | timestamp | |
| completedAt | timestamp? | |
| supersededAt | timestamp? | |

语义：

- 一个 Quest 同一时刻最多只有一个 `active` cycle
- `completed` 表示本轮计划已走完
- `superseded` 表示计划方向被后续轮次替换
- `cancelled` 表示本轮中止且不再继续

### 2. ProgressItem

本设计不要求引入独立 `ProgressItem` 表。

当前实现已经用 Todo 承载 Progress 条目，因此建议继续复用 Todo 作为 item 载体，并新增对 Cycle 的归属关系。

建议新增关联字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| progressCycleId | string? | 归属 ProgressCycle |

条目状态继续使用现有语义：

- `pending`
- `doing`
- `waiting`
- `done`
- `cancelled`

## 状态机

### Quest 内的 Progress 推进状态

```
无 active cycle
  -> 创建新 cycle
  -> 创建本轮 2～4 个中层 item（大型任务最多 5 个）
  -> 进入逐步执行

执行某 item
  -> item done
  -> 判断任务是否完成
     -> 完成：结束当前 cycle，Quest 进入完成态
     -> 未完成且仍有 pending item：继续当前 cycle
     -> 未完成且当前 cycle 已走完：创建下一轮 cycle
```

### 聊天修正触发的状态变化

用户聊天输入进入当前 Quest 后，Agent 需要先判断它是否属于“计划修正消息”。

支持的修正类型：

1. **重排**
   - 调整当前 cycle 中未来步骤顺序

2. **插入**
   - 向当前 cycle 增加一个新步骤

3. **合并 / 删除**
   - 删除多余 future item，或把几个 future item 合并

4. **改向**
   - 当前任务目标发生明显变化
   - 当前 cycle 标为 `superseded`
   - 新建下一轮 cycle

默认情况下，完成当前 cycle 内一个 item 后，Agent 需要先判断整个任务是否已经结束；
只有任务仍未完成，才继续当前 cycle 的后续步骤或开启下一轮 cycle。

## 规划粒度规则

### 1. 中层阶段优先

Progress item 默认代表“用户能理解的阶段目标”，不是操作动作。

可接受：

- 梳理现有实现与限制
- 完成主要改动
- 补齐测试并验证

不可接受：

- 搜索某个文件
- 修改一个函数
- 跑一条命令

### 2. 一轮计划默认 2-4 项

一轮 cycle 的默认规模建议是 `2-4` 项；大型任务最多 `5` 项。

- 简单任务可以是 `2-3`
- 复杂任务可以到 `5`
- 但原则上不鼓励一开始拆成大量细碎步骤

### 3. 当前具体，未来较粗

本轮当前 `doing` 项可以稍具体一些；
未来 `pending` 项应保持中层抽象，避免把远期计划写成施工清单。

### 4. 微动作只进入 active-form

Progress item 的 `title` 表示阶段目标；
`activeForm` 才承载当前具体动作。

例如：

- title: `调整 Prompt 与规划规则`
- activeForm: `正在比对社区 prompt 与当前 system prompt`

并且不是所有后台操作都需要进入 Progress。

例如：

- 并行读取多个文件
- 内部搜索或脚本执行
- 为验证准备临时中间结果

这些动作可以不单独显示为 Progress item，只要用户仍能看懂任务推进到了哪一阶段。

### 5. 只有新目标才开启下一轮

开启下一轮 cycle 的前提应是：

- 当前 cycle 已走完但任务仍未完成
- 或用户通过聊天提出了新的目标 / 明显扩展了当前目标

如果只是调序、补一步或微调方案，不应轻易开启新 cycle。

自然完成时默认用结果回复收口，不为“请确认 / 请复核 / 是否继续”这类低价值尾巴单独创建 Todo、Progress、Reminder 或 Check-in；只有后续人工动作明确、必要、可执行时才追加少量承接项，避免用户信息爆炸。

### 6. 中途聊天消息默认参与当前计划

如果任务进行中用户发来新消息，默认先判断它是否改变当前计划方向。

- 若只是修正、补充、调序：吸收到当前 cycle 的 future items
- 若明显改向：结束当前 cycle，进入下一轮

不应忽略中途消息，继续机械执行旧计划。

## UI 承接

用户可以继续看到完整 Progress，但展示结构应转为“按 cycle 分组”，而不是一条平铺长列表。

建议结构：

```text
Cycle 3 · 当前推进
  ● 调整 Prompt 与规划规则
  ○ 补充测试与文档
  ○ 验证并收尾

Cycle 2 · 已完成
  ✓ 梳理当前 Progress 机制
  ✓ 确定粒度与规划方向
  ✓ 修复 Progress 展示问题
```

设计原则：

- 当前 `active` cycle 默认展开
- 历史 cycle 可折叠，但允许查看全部
- `superseded` cycle 要与当前 cycle 明确区分

## 方案取舍

### 方案 A：只改 prompt，不引入 cycle 对象

优点：

- 成本最低
- 先改善 Agent 行为

缺点：

- 无法稳定表达“这一轮计划”与“下一轮计划”
- 前端无法可靠分组
- 用户计划修正后缺少结构化历史

结论：可作为短期优化，但不足以完整满足本需求。

### 方案 B：复用 Todo 作为 item，新增 ProgressCycle（本设计采用）

优点：

- 延续现有 Progress 实现基础
- 新增的结构语义最少但最关键
- 可以同时改善 Agent、API 和 UI

缺点：

- 需要给 Todo 增加 cycle 关联
- Progress 查询结构会升级

结论：采用。

### 方案 C：完全新建 ProgressCycle + ProgressItem 体系

优点：

- 语义最纯粹
- 长期扩展空间更大

缺点：

- 与现有 Todo-based Progress 路径偏差过大
- 迁移成本高

结论：当前阶段不采用。

## 分期建议

### Phase 1

- 引入 ProgressCycle 语义
- 继续复用 Todo 作为 item
- Prompt 升级为 cycle-based planning 规则
- Quest Progress API 支持按 cycle 返回
- UI 按 cycle 分组展示

### Phase 2

- 支持显式的计划修正事件记录
- 支持手动结束 / 替换当前 cycle
- 支持更清晰的 cycle 摘要和切换历史
