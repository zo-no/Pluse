# 0003 — Agent 驱动的会话分类能力设计

**状态**: draft
**类型**: design
**关联 requirement**: `docs/v2/requirements/0003-agent-driven-session-classification.md`

## 设计目标

这份 design 要回答的是：

- Pluse 应该把会话分类做成什么样的系统能力
- 这项能力哪些部分属于产品，哪些部分属于 Agent 策略
- 它如何兼容当前 `Quest` 统一模型与会话导航

## 设计立场

- `Capability-first`
  - 做会话分类承接能力，不做内置分类方法论

- `Agent-managed`
  - Agent 是默认分类维护者，人类不是默认整理者

- `Project-scoped`
  - 会话分类默认只在单个 Project 内成立

- `Low-friction`
  - 分类必须低成本、低耦合、可被重写

## 核心命名

这条能力在 v2 中统一命名为：

- `SessionCategory`

不再沿用 `SessionGroup` 作为主命名。

原因：

- `group` 更像人为整理容器
- `category` 更强调语义归类
- 当前要解决的是 Agent 写回语义结构，而不是人手工排布列表

## 产品边界

### Pluse 负责什么

Pluse 本体负责：

- 提供 `SessionCategory` 这个稳定对象
- 提供会话到分类的归属关系
- 提供项目内作用域、校验和删除解绑语义
- 在会话导航面消费分类结果
- 向 Agent 暴露明确的 HTTP / CLI 能力

### Agent 负责什么

Agent 负责：

- 决定是否需要创建新分类
- 决定分类命名
- 决定某个会话属于哪个分类
- 决定何时重分类
- 决定分类门槛与不确定时的处理策略

Pluse 不负责：

- 内置固定 taxonomy
- 猜测“正确分类”
- 后台持续替 Agent 自动作判断
- 固化“什么时候允许新建分类”的产品级门槛

如果后续需要自动分类器，那是建立在这个承接层之上的 Agent 策略或独立能力，不属于这个 design 的默认前提。

## Hooks 定位

这项能力和 hooks 的关系应明确为：

- hooks 是 Project 级控制面，消费 Quest / Run 生命周期事件
- core model 提供 `SessionCategory` 与 Quest 归属能力
- hooks 可以消费这些能力，驱动自动分类
- hooks 是策略层，不是状态承接层

也就是说：

- 没有 hooks，系统仍然有完整的分类 substrate
- 有 hooks 时，Agent 可以在合适时机自动调用分类能力

因此分类门槛、复用偏好、重分类时机等规则，默认应写在 hook / prompt policy 中，而不是硬编码进产品内核。

这也意味着：

- 本次会话分类只是挂在 Project hooks 上的一条策略
- 后续如果做任务分类，应优先复用同一套 hook / event 框架
- 但不应因为未来可能有任务分类，就在当前阶段过早把分类 substrate 抽象成一个过大的统一模型

## 两层结构

这条能力推荐拆成两层：

### 第一层：分类 substrate

产品先提供：

- `SessionCategory`
- `quest.sessionCategoryId`
- 分类 CRUD / assign / clear
- 会话导航面消费分类结果

这层负责“分类结果放哪”。

### 第二层：分类 hooks

在 substrate 成立后，再通过 hooks 让 Agent 自动做分类。

这层负责：

- 什么时候触发分类
- 调用哪个 Agent 能力
- 是否允许创建新分类
- 不确定时如何处理

这层负责“什么时候分、怎么分”。

## Phase 1 默认 hook 形态

Phase 1 推荐的默认自动化不是持续重分类，而是一次性的首轮分类 hook。

推荐行为：

- 基于通用的 Quest 生命周期 hook，而不是产品内置一个 `session.classify` 专用 hook 名
- 只对 `kind='session'` 生效
- 在会话完成首轮有效 chat run 后触发
- 最好与自动命名处于同一类“首轮会话后补全元数据”的体验链路
- 默认只执行一次
- 第二轮及之后默认不自动重复触发

这样做的原因是：

- 首轮会话后通常已经有足够语义信号
- 与自动命名的用户心智一致
- 能避免 session 在后续对话中频繁跳类

后续如果确实需要重分类，应作为单独能力讨论，而不是在 Phase 1 默认打开。

也就是说：

- hook 名应是通用事件或通用阶段
- “会话分类”只是该 hook 下的一条 Agent 策略
- “自动命名”也可以挂在同一个通用阶段下

## 与现有 hooks 骨架的关系

当前仓库已经有一套 Project 级 `hooks.json` 骨架：

- 通用 `event`
- `filter`
- `actions`

因此 v2 不应再发明一套新的分类 hook 结构，而应在现有骨架上扩展：

- 继续复用 `run_completed`
- 扩展 filter 表达力
- 新增通用的 Agent action

### 推荐的扩展方向

#### 1. 事件继续复用 `run_completed`

会话首轮分类与自动命名都属于：

- Quest 一轮执行完成后
- 对 Quest 元数据做补全

因此没有必要新增一个更定制化的事件名。

#### 2. filter 增量补足场景判断

为了让 hooks 精确命中“首轮会话完成后做元数据补全”，filter 需要能表达：

- `trigger == chat`
- `firstCompletedChatRun == true`

这样自动命名和自动分类都能挂在同一命中条件下。

#### 3. Phase 1 action 收窄成 `agent_classify_session`

既然 Phase 1 已明确：

- 只做会话分类
- 不迁移自动命名

那么继续保留一个过宽的通用 action（如 `agent_patch_quest`）就属于提前设计。

因此 Phase 1 推荐直接使用一个边界清晰的专用 action：

- `agent_classify_session`

它的职责只有：

- 调用一次 Agent
- 返回一次分类判断
- 如有需要，创建或复用一个 `SessionCategory`
- 最后写回 `quest.sessionCategoryId`

如果 Agent 没有给出可用分类，系统仍应避免把首轮会话留在未分组区。Phase 1 可以接受一个宽口径 holding category（例如 `临时探索`）作为兜底承接面。

自动命名暂不迁入 hooks，而是继续走现有 auto-rename 链路；后续若需要统一“首轮元数据补全”，再讨论是否抽象出更通用的 Quest metadata action。

#### 4. Agent action 必须后台异步执行

`agent_classify_session` 不属于当前 hooks 里那种“瞬时本地动作”。

它至少包含：

- 调用 Agent
- 等待结构化结果
- 可能创建分类
- 再回写 Quest

因此它必须作为后台异步 action 运行：

- 不阻塞 `run_completed`
- 不延迟当前 Run 进入终态
- 失败不影响当前 Run，只影响这次元数据补全是否成功

这条边界很重要，因为会话分类属于 post-run enrichment，而不是 run 主流程的一部分。

## 核心结构

### 1. 引入项目内的 `SessionCategory`

`SessionCategory` 是一个 Project 作用域内的轻量对象。

它的职责只有两个：

- 作为会话分类的命名容器
- 作为导航面的语义分区依据

它不是：

- Task 分类
- Todo 分类
- 全局标签系统
- 多层知识树

### 2. Quest 只保存一个主分类

一个 `Quest` 在任意时刻最多归属一个 `SessionCategory`。

即：

- `0..1` category per Quest

不做多标签的原因：

- 当前目标是让会话空间可导航，而不是建立复杂知识图谱
- 多标签会立即带来重复展示、冲突处理和筛选复杂度
- Agent 维护成本会明显上升

### 3. 未分类是默认状态

系统不强制所有会话都必须被分类。

因此：

- `sessionCategoryId` 可为空
- 空值表示 `Uncategorized`

这能避免 Agent 在每次创建会话时被迫先做分类决策。

### 4. 分类是语义层，不替代 attention 层

现有 `pinned` 仍然保留。

设计上：

- `pinned` 表达“当前关注优先级”
- `SessionCategory` 表达“语义归属”

两者不互相替代。

为了避免重复展示，导航面应把 `Pinned` 作为单独投影视图，已置顶会话默认不重复出现在分类区。

### 5. 分类状态跟随 Quest 身份，而不是跟随当前展示形态

`session -> task -> session` 是同一个 `Quest` 的形态切换。

因此：

- Quest 切到 `task` 时保留 `sessionCategoryId`
- `kind='task'` 时导航面不消费该字段
- 切回 `session` 后恢复原分类

这与当前 Quest 的 provider context 和 task 配置保留语义一致。

### 6. 跨项目移动时清空分类

`SessionCategory` 是 Project 作用域对象。

因此 Quest 跨项目移动时：

- 必须清空 `sessionCategoryId`
- 不做按名字自动匹配

原因是分类语义高度依赖项目上下文，自动匹配会引入隐式错误。

## 导航面设计

会话导航面改为消费分类能力，但不以“手动整理入口”为中心。

推荐结构：

1. `Pinned`
2. `Categories`
3. `Uncategorized`
4. `Archived`

其中：

- `Pinned` 是 attention override
- `Categories` 按 `SessionCategory` 渲染多个分区
- `Uncategorized` 承接未被分类的会话
- `Archived` 保持现有语义

Phase 1 不要求提供复杂的手动分类管理 UI。

也就是说，这个设计的中心不是“用户怎么拖拽整理”，而是“系统怎么展示 Agent 已经写回的分类结果”。

## 人类参与策略

这项能力不禁止人类干预，但人类干预不是主路径。

设计上应遵循：

- Agent 默认维护分类
- Human 可在必要时查看和覆盖
- Human 不需要被要求先定义完整分类体系

Phase 1 可以只保证系统能力对 Agent 可用，并让 UI 正常消费结果；不要求完整的人手动管理面板。

## 分期建议

### Phase 1: 分类承接层

先建立：

- `SessionCategory` 对象
- Quest 到 category 的单值归属
- Agent 可调用的 CRUD / assign / clear 能力
- 会话导航面按分类渲染

### Phase 2: 轻量人工纠偏

在基础承接层稳定后，再考虑：

- 人类在 UI 中轻量改分类
- 批量重分类
- 分类合并或清理

### Phase 3: 更强的 Agent 策略

最后再考虑：

- 分类建议
- 分类漂移治理
- 与更高层目标或工作面联动

## 关键取舍

### 1. 先做分类 substrate，不做后台自动分类器

没有稳定 substrate 前，任何自动分类都只是瞬时判断，无法形成产品能力。

### 2. 先做单主分类，不做多标签

单主分类足以显著改善导航面，而且不会把系统复杂度快速拉高。

### 3. 先做导航消费，不做复杂手动管理 UI

这项能力的主价值是：

- Agent 写得回去
- Human 看得出来

而不是：

- Human 又多了一套要维护的面板
