# 0010 — Project Priority Tiers And Visibility

**状态**: draft
**类型**: design
**关联 requirement**: `docs/v2/requirements/0010-project-priority-tiers-and-visibility.md`
**关联上位 design**: `docs/v2/designs/0001-human-workload-control.md`

## 设计目标

这份 design 要解决的是：

- 如何把提醒侧已有的项目优先级收敛成 Project 的统一能力
- 如何引入 `low` 作为“停放但不归档”的稳定层级
- 如何让项目入口、提醒分组和默认折叠行为使用同一套语义

它不是一个单纯的 UI 标签设计，也不是只给 reminder 排序补一个枚举值。

## 设计立场

- `Project-first`
  - 项目优先级应属于 Project 本体语义
  - 提醒、项目列表、项目分组都应从这里继承，而不是各自维护口径

- `Mainline protection`
  - 优先级体系首先服务于长期主线保护，而不是列表美化

- `Low-noise parking`
  - `low` 的核心作用是降低默认注意力占用，而不是制造新的归档态

- `Single hierarchy`
  - 系统内对项目重要性的表达应只有一套主口径

## 非目标

这份 design 不讨论：

- 具体 SQL migration 语句
- 具体 HTTP / CLI 参数名
- 具体颜色、icon、CSS 样式
- 自动推断优先级算法

这些内容进入后续 spec。

## 核心能力结构

### 1. Project 统一优先级

系统引入一套统一的 `project priority` 语义，四档如下：

- `mainline`
- `priority`
- `normal`
- `low`

含义约束：

- `mainline`
  - 用户当前最核心、最受保护的长期推进主线
  - 默认数量应非常少

- `priority`
  - 当前明确要推进，但不属于唯一主线

- `normal`
  - 正常在线项目
  - 允许持续存在，但默认资源保护弱于前两档

- `low`
  - 暂不推进，但保留在线
  - 默认应降低展开权和打断权

### 2. `low` 作为停放层，而非归档层

`low` 与 `archived` 必须严格区分：

- `low`
  - 项目仍活跃存在
  - 仍允许有 Quest、Todo、Reminder、自动化
  - 仍可直接进入
  - 只是默认注意力权重更低

- `archived`
  - 项目离开 active 工作面
  - 进入归档区

### 3. 统一排序层

项目级排序应先按优先级层级，再按现有项目排序信号工作。

默认层级顺序：

1. `mainline`
2. `priority`
3. `normal`
4. `low`

在同档内继续复用现有规则，例如：

- `pinned`
- 最近更新时间
- 既有分组顺序

### 4. 统一分组与折叠层

只要界面采用“项目分组”而不是单列表，就应默认使用同一顺序：

1. 主线
2. 优先
3. 普通
4. 低优先

其中：

- `low` 默认折叠
- 其他三档默认展开

这个折叠规则应至少适用于：

- 提醒项目分组
- 左侧项目入口 / 项目切换器中的优先级分组

### 5. 统一透出层

项目优先级需要在主要项目入口中直接可见。

最小透出要求：

- 用户在项目列表中不进入项目详情，也能识别优先级
- 当前项目 header / 入口区域能看出该项目属于哪一档

透出方式可以是：

- 文案 badge
- 分组标题
- 紧凑标签

但语义必须统一，不应出现一处叫“主线”，另一处改成“核心项目”等分裂文案。

## 关键设计决策

### 1. 收敛 reminder project priority，而不是长期双轨

当前 reminder 模块的 `ReminderProjectPriority` 与 Project 的长期重要性表达的是同一件事。

因此目标应是收敛，而不是长期保留：

- `Project.priority`
- `ReminderProjectPriority`

两套并行源。

后续提醒排序应读取统一项目优先级，提醒模块不再拥有独立项目优先级真相源。

### 2. `mainline` 仍保持稀缺，但不在本期强制 UI 限制数量

当前提醒模块已有“设置一个主线会把旧主线降级”的行为。

这说明系统倾向于：

- `mainline` 稀缺
- 最多一个主线

本期 design 延续这个产品方向：

- 默认继续维持“同一时间一个 mainline”的系统语义

但是否在所有入口强制即时互斥、以及如何提示，是 spec 里的实现问题。

### 3. 项目优先级属于产品能力，不下放给 Agent policy

这里处理的是稳定的跨入口系统语义：

- 项目排序
- 项目透出
- 默认折叠
- 提醒 attention 顺序

因此它应进入 Pluse 产品本体，而不是只放在 agent prompt 中约定。

## 模块边界

### Project

Project 成为项目优先级的主承载对象。

Project 侧负责：

- 持久化优先级
- 对外提供统一字段
- 承担默认值与迁移后真相源

### Reminder

Reminder 模块不再定义独立的项目重要性语义。

Reminder 侧负责：

- 读取项目优先级参与 attention 排序
- 在提醒分组中展示相同层级
- 复用统一文案与顺序

### Project Entry UI

项目入口负责：

- 展示项目优先级
- 按优先级分组或排序
- 对低优先分组默认折叠

### Overview / Project Header

项目详情入口负责：

- 让用户在进入项目后持续知道该项目当前所属层级

## 分期建议

### Phase 1

先完成统一语义闭环：

- Project 层引入统一优先级
- 从 reminder project priority 迁移
- 项目列表 / 主要入口透出优先级
- 提醒分组新增 `low`
- 低优先分组默认折叠

### Phase 2

在统一语义稳定后，再考虑更深能力：

- 基于优先级的跨项目筛选
- 更复杂的项目注意力预算
- 不同优先级的默认提醒策略
- 与自动化成熟度、项目闭环程度联动

## 关键取舍

### 1. 先统一语义，再优化视觉

如果底层还是 reminder/private config，先做更多 badge 只会扩大语义漂移。

### 2. 先显式分层，不先做自动推断

当前最关键的是给用户一个稳定、可控、清晰的项目层级结构，而不是让系统猜。

### 3. `low` 优先做默认降噪，不做新的状态机

`low` 的目标是减少默认展开和注意力竞争，不是引入额外生命周期状态。

## 设计完成标准

这份 design 达到可进入 spec 的标准应是：

- 已明确项目优先级是 Project 的统一能力
- 已明确四档层级及其语义
- 已明确 `low` 与 `archived` 的边界
- 已明确排序、分组、折叠、透出需要统一
- 已明确 reminder project priority 的收敛方向
