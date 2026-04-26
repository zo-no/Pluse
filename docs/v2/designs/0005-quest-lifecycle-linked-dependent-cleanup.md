# 0005 — Quest 生命周期关联对象剪枝设计

**状态**: draft
**类型**: design
**关联 requirement**: `docs/v2/requirements/0005-quest-lifecycle-linked-dependent-cleanup.md`

## 设计目标

这份 design 要回答的是：

- 当前系统里哪些对象拥有明确生命周期
- 哪些对象是主对象，哪些对象只是派生物
- Quest 归档引发的 review Todo 剪枝应该挂在哪一层
- 如何先做最小闭环，而不提前抽象成通用生命周期引擎

## 设计立场

- `Owner-driven`
  - 生命周期 cleanup 由主对象 owner 负责，不由外围策略层兜底

- `Reference-is-not-ownership`
  - 关联字段只表达引用，不自动表达级联归属

- `Asymmetric-archive`
  - 归档和恢复不必完全对称；被主动剪枝的噪音信号默认不自动恢复

- `Smallest-closed-loop`
  - 先解决 Quest 归档与 review Todo 剪枝的最小闭环，再考虑更通用的扩展

## 当前对象生命周期总览

### 1. 主对象

这些对象拥有自己的稳定生命周期，由自身 service 主控：

| 对象 | 当前生命周期 | 主控层 |
| --- | --- | --- |
| `Domain` | `active -> deleted(soft)` | `services/domains.ts` |
| `Project` | `active -> archived` | `services/projects.ts` |
| `Quest` | `created -> kind/status changes -> moved -> archived/restored` | `services/quests.ts` |
| `Todo` | `pending/done/cancelled -> deleted(soft)` | `services/todos.ts` |

### 2. 执行历史对象

这些对象属于历史与执行记录，不应因为 Quest 归档而被当作噪音清理：

| 对象 | 当前生命周期 | 设计语义 |
| --- | --- | --- |
| `Run` | `accepted -> running -> completed/failed/cancelled` | Quest 历史的一部分 |
| `QuestOp` | append-only | Quest 历史的一部分 |
| `ProjectActivity` | append-only | Project 历史的一部分 |
| `Asset` | 创建后跟随 Quest 存储 | 上下文资产，不是 attention signal |

### 3. 派生承接对象

这些对象不是 Quest 历史本身，而是系统为了组织、提醒或展示而派生出来的承接层：

| 对象 | 当前语义 | 生命周期特征 |
| --- | --- | --- |
| `SessionCategory` | Project 内会话分类承接层 | Quest 解绑后可自动回收空分类 |
| `system review Todo` | Quest / Run 派生的人类 review 信号 | 源 Quest 退出工作面后应可被收敛 |

### 4. 关键判断

这张表说明一个核心边界：

- `Quest` 归档不会统一影响所有关联对象
- 只有“由 Quest 派生、且只服务于当前注意力面”的对象，才适合被跟随收敛

## 生命周期归属原则

### 1. 引用不自动产生级联

`originQuestId` 只表示：

- Todo 来自哪个 Quest

它不表示：

- Todo 的生命周期被 Quest 拥有

因此不能因为某条 Todo 有 `originQuestId`，就默认它应跟随 Quest 归档。

### 2. 派生对象必须由规则显式认定

某个对象是否应随主对象收敛，必须由产品规则明确认定，而不是靠“看起来像”。

对当前问题而言，Phase 1 要认定的是：

- `createdBy = system`
- `tags` 包含 `review`
- `originQuestId = 当前 Quest`

这类 Todo 属于 Quest 派生的 review 信号。

### 3. 历史对象保留，注意力对象收敛

Quest 归档后：

- 历史要保留
- 上下文资产要保留
- 独立承诺要保留
- 只服务于当前注意力面的 review 噪音应被收敛

### 4. cleanup 由生命周期 owner 发起

由于 Quest 是归档动作的 owner：

- Quest service 负责决定何时触发 cleanup
- Todo service 负责执行“哪些 Todo 应被归档”

hooks 不负责 cleanup 编排。

## 为什么不放在 hooks

当前 hooks 的角色是：

- 在 `run_completed` / `run_failed` 后决定是否生成新的信号

它解决的是：

- 什么时候创建 review Todo

而当前要解决的问题是：

- Quest 归档时如何收敛已经存在的派生信号

这属于 Quest 生命周期管理，而不是 run 后策略。

如果把 cleanup 放进 hooks，会引入三个问题：

- hooks 当前并不拥有 Quest archive 事件
- cleanup 会和创建逻辑继续分散在不同层
- 后续每种派生对象都可能把“清理权”塞进自己的策略层，边界继续失控

因此这里应明确：

- hooks 负责 signal creation
- Quest service 负责 lifecycle-driven cleanup

## Phase 1 设计边界

### 做什么

Phase 1 只定义一条明确规则：

- 当 Quest 被归档时，归档该 Quest 派生的 system review Todo

### 不做什么

Phase 1 不做：

- 通用 dependent object engine
- 新的 hooks 事件面
- Project / Domain 级级联策略
- Todo 新类型体系
- Quest 恢复时的反向自动恢复

## 推荐结构

### 1. Quest 作为 cleanup 编排入口

在 `services/quests.ts` 的 Quest 归档分支上挂接 cleanup。

触发点应是：

- `before.deleted === false`
- `updated.deleted === true`

而不是其他弱信号。

### 2. Todo service 提供明确的剪枝能力

Todo service 提供一个边界清晰的能力，例如：

- `archiveQuestReviewTodosWithEffects(...)`

由它负责：

- 找出满足规则的 Todo
- 逐条归档
- 发出已有 activity / SSE effects

### 3. 归档与恢复保持非对称

Quest 恢复时默认不反向恢复先前被剪枝的 review Todo。

原因：

- review Todo 是旧 attention signal
- 恢复 Quest 只是恢复工作容器，不等于恢复旧提醒
- 若恢复后仍需要 review，应由新的 run / hooks 再次产生新的信号

## 未来扩展方向

这套设计后续可以扩展到其他派生对象，但不要求现在统一抽象。

后续若继续推进，可以按同一原则判断：

- 它是主对象吗
- 它是历史对象吗
- 它是独立承诺吗
- 它只是派生出来的 attention signal 吗

只有最后一类，才优先考虑生命周期跟随剪枝。

## 设计完成标准

这份 design 达到可进入 spec 的标准应是：

- 已明确当前对象生命周期分类
- 已明确 Quest archive cleanup 的 owner 是 Quest service
- 已明确 review Todo 为 Phase 1 唯一剪枝对象
- 已明确普通 Todo、Run、历史记录不跟随本次 cleanup
- 尚未下沉到具体函数名、测试实现和代码补丁
