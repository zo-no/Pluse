# 0013 — Todo Broker / Human Work Control Plane

**状态**: draft
**类型**: feature
**优先级**: high
**估算**: L

## 背景

当前 Pluse 的 Todo 已经具备基础能力：

- 独立于 Quest 的人工待办对象
- `priority / tags / dueAt / repeat` 等字段
- CLI / API / 前端面板完整链路

但它仍然停留在“记录项”层，不足以承担“人类闭环控制器”职责。当前主要问题有四类：

1. **查看体验是平的**
   - `pending` 列表同时混合 `现在要做 / 之后再做 / 等待中 / review / system 生成`
   - 用户打开任务面板后，看到的是一个被排序过的集合，而不是一个被约束的焦点队列

2. **Agent 缺少统一约束**
   - 当前任意 Agent 都可以直接创建 Todo
   - 系统缺少统一的去重、合并、降级、WIP 限制、通知门槛
   - 多 Agent 场景下，Todo 数量会自然膨胀

3. **“让人做什么”与“什么时候打扰人”没有分离**
   - Todo 既承担工作项，又隐含承担提醒和中断语义
   - 缺少一个代表用户利益做全局调度的准入层

4. **Kairos / 通知能力缺乏统一入口**
   - 理想状态下，通知不应由各个 Agent 直接决定
   - 是否打断用户，应该由一个统一的 control plane 判断

因此需要把 Todo 从“平面待办数据表”提升为“人类工作队列控制面”。

## 目标

- 引入一个面向人类闭环的 `Todo Broker`，作为 Agent 创建 Todo 的统一入口
- 所有 Agent 创建“需要人类介入”的工作项时，先提交 `TodoIntent`，而不是直接写 Todo
- Todo 显式区分生命周期、焦点位置和任务类型，避免单个 `pending` 集合承载所有语义
- 通过确定性规则优先、模型推理兜底的方式，统一处理去重、分流、升级、降级和通知
- 为 Kairos 等通知能力提供单一决策出口

## 不在范围内

- 把 Todo Broker 拆成独立 repo 或独立产品
- 替换 Project / Quest / Run 的现有归属关系
- 自动生成完整人生规划系统
- 用模型完全替代规则，不引入任何显式约束
- 一次性重写所有 Todo UI 细节

## 核心决策

### 1. Broker 是 Pluse 内部子系统，不是外部产品

- 正式数据仍归属于 Pluse
- `Project / Quest / Todo` 仍然是单一真相源
- Broker 可以暴露为独立 CLI / service 边界，但不应脱离 Pluse 代码库和数据模型

### 2. Agent 只能提交 `TodoIntent`，不能直接创建焦点 Todo

Agent 想让人类做事时，只能先提交意图，例如：

```ts
interface TodoIntent {
  projectId: string
  originQuestId?: string
  title: string
  whyHuman: string
  blocking: boolean
  urgencyHint?: 'urgent' | 'high' | 'normal' | 'low'
  dueAtHint?: string
  suggestedLane?: 'now' | 'next' | 'waiting' | 'backlog'
  kind?: 'action' | 'review' | 'approval' | 'info'
}
```

Broker 再决定：

- 是否创建新 Todo
- 是否合并进已有 Todo
- 放进哪个 lane
- 是否需要通知
- 是否可以进入 `now`

### 3. 生命周期、焦点位置、任务类型必须拆开

当前 `status` 不足以表达所有语义，需要拆成三个维度：

#### 生命周期

```ts
type TodoStatus = 'open' | 'done' | 'cancelled'
```

#### 焦点位置

```ts
type TodoLane = 'now' | 'next' | 'waiting' | 'backlog'
```

#### 任务类型

```ts
type TodoKind = 'action' | 'review' | 'approval' | 'info'
```

说明：

- `status` 只表达这件事是否关闭
- `lane` 只表达它在当前人类工作队列中的位置
- `kind` 只表达它是什么类型的人类介入

### 4. 规则优先，推理兜底

第一版 Broker 不应每次都调用一个“Todo 智囊 Agent”做自由讨论。  
更稳的策略是：

1. 先跑确定性规则
2. 规则无法决策时，再调用推理层做 rebalance / merge 判断

规则层负责：

- lane 容量限制
- 去重
- 合并
- 非阻塞项默认降级
- review 项与 action 项分流
- 通知门槛

推理层只负责：

- 两个或多个 Todo 是否本质重复
- 当前全局焦点是否需要重排
- 是否值得打断用户

### 5. `now` 是稀缺资源，不能直接写入

第一版默认约束：

- 每个 Project 的 `now` Todo 最多 `3` 条
- Agent 不允许直接创建 `lane='now'`
- 非阻塞 Todo 默认只能进入 `next` 或 `backlog`
- 若要进入 `now`，Broker 必须显式做“挤出/降级”决策

## 方案设计

### 数据模型

#### Todo 增量字段

```ts
interface Todo {
  // existing fields...
  status: 'open' | 'done' | 'cancelled'
  lane: 'now' | 'next' | 'waiting' | 'backlog'
  kind: 'action' | 'review' | 'approval' | 'info'
  source: 'human' | 'agent' | 'system'
  brokerReason?: string
  lastEvaluatedAt?: string
}
```

新增字段语义：

- `lane`: 当前在用户工作队列中的位置
- `kind`: 区分真正行动项和 review / approval
- `source`: 谁触发了它
- `brokerReason`: Broker 为什么做出当前分配
- `lastEvaluatedAt`: 最近一次被 broker 评估的时间

#### 新增 `TodoIntent`

第一版建议落库，保留审计链：

```ts
interface TodoIntent {
  id: string
  projectId: string
  originQuestId?: string
  proposedBy: 'agent' | 'human' | 'system'
  title: string
  whyHuman: string
  blocking: boolean
  urgencyHint?: 'urgent' | 'high' | 'normal' | 'low'
  dueAtHint?: string
  suggestedLane?: TodoLane
  kind?: TodoKind
  status: 'accepted' | 'merged' | 'rejected'
  resolvedTodoId?: string
  createdAt: string
  resolvedAt?: string
}
```

目的：

- 记录 Agent 原始诉求
- 保留 Broker 决策链
- 为后续 prompt / policy 调优提供真实样本

### Broker 决策输出

```ts
interface TodoDecision {
  action: 'create' | 'merge' | 'defer' | 'promote' | 'reject'
  lane: TodoLane
  kind: TodoKind
  notify: boolean
  targetTodoId?: string
  reason: string
}
```

### 决策流程

```text
Agent / system / human
  -> submit TodoIntent
  -> Todo Broker load current state
  -> deterministic rules
  -> optional reasoning layer
  -> create/update/reject Todo
  -> optional Kairos notify
```

### 第一版规则

#### 1. 去重 / 合并

若同一 Project 下存在未关闭 Todo，且满足以下任一条件，则优先合并而不是新建：

- 相同 `originQuestId` 且标题高度相似
- 相同 `kind` 且都描述同一个人类动作
- 已有 Todo 仍在 `now / next / waiting`

#### 2. lane 分配

- `blocking = true` 且 `now` 未满：进入 `next`，再由显式 promote 进入 `now`
- `blocking = false`：默认 `backlog`
- `kind = 'review'`：默认 `backlog`
- `kind = 'approval'`：默认 `waiting`

#### 3. WIP 约束

- Project 级 `now <= 3`
- Project 级 `next <= 5`
- 超出容量时，Broker 必须给出降级决策和 reason

#### 4. 通知门槛

只有满足以下条件之一，才允许通知：

- 阻塞当前执行链
- 截止时间明确且临近
- `approval` 类项卡住自动化

其他情况只入队，不打扰。

## CLI / Service 边界

第一版不建议新建独立二进制；先复用 `pluse todo` 命名空间扩展：

```bash
pluse todo propose ...
pluse todo decide <intent-id>
pluse todo focus --project-id <id>
pluse todo rebalance --project-id <id>
```

其中：

- `todo propose`：Agent / system 提交 `TodoIntent`
- `todo decide`：内部使用或调试使用
- `todo focus`：输出 `now / next / waiting / backlog`
- `todo rebalance`：按规则重排 lane

实现位置建议：

- `packages/server/src/services/todo-broker.ts`
- `packages/server/src/models/todo-intent.ts`
- `packages/server/src/controllers/http/todos.ts`
- `packages/server/src/controllers/cli/todo.ts`

## UI 变更方向

### 1. 任务面板改为焦点队列视图

默认展示顺序：

1. `Now`
2. `Next`
3. `Waiting`
4. `Backlog`

不再默认展示“一个按排序规则排出来的 pending 列表”。

### 2. `review / approval` 单独标识

即便保留在 Todo 面板中，也必须在视觉上与普通 `action` 区分。

### 3. 默认折叠 backlog

用户打开面板时，优先看到当前应该处理的少量事项，而不是全部历史积压。

## Kairos 集成

Kairos 不直接读取所有 Todo 发通知。  
Kairos 只接受 Broker 输出的通知决策：

```ts
interface TodoNotification {
  todoId: string
  projectId: string
  title: string
  reason: string
  urgency: 'urgent' | 'high' | 'normal'
}
```

这样可以保证：

- 通知来源单一
- 打扰门槛统一
- 不同 Agent 不会绕过规则直接叫人

## 验收标准

- [ ] 引入 `TodoIntent` 概念，并提供 CLI / API 提交入口
- [ ] Agent 创建人类介入项时，不再直接调用 `todo create`
- [ ] Todo 新增 `lane / kind / source` 字段
- [ ] Todo 面板默认展示 `now / next / waiting / backlog`
- [ ] `now` 容量限制可执行，Agent 不能直接写入 `now`
- [ ] Broker 可以做 `create / merge / defer / promote / reject`
- [ ] Kairos / 通知能力改由 Broker 决定是否触发

## 备注

- 这版的本质不是“再做一个 Todo CLI”，而是为人类工作队列增加准入层
- Todo Broker 是 Pluse 的内部 control plane，不是外部产品
- 若后续验证有效，再考虑是否拆出独立 process / daemon；第一版不需要提前抽离
