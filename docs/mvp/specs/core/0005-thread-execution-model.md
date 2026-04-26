# 0005 — Quest 执行模型

**状态**: draft  
**类型**: core  
**优先级**: high  
**依赖**: 0003-quest-unified-model.md, 0004-cross-agent-context-model.md

---

## 背景与动机

Quest 支持三种触发来源（chat / manual / automation），每种触发来源的行为、回写逻辑、并发约束不完全相同。本 spec 定义执行模型的完整规范，确保实现者对以下问题有一致的理解：

1. 三种 run 触发来源的完整流程
2. Run 如何回写 Quest
3. follow-up queue 与自动触发的并发约束
4. 同一 Quest 同时只能有一个活跃写入 run
5. continueQuest 的 resume / fresh_context 策略

---

## 三种触发来源

| 触发来源 | `runs.trigger` | `runs.triggered_by` | 触发方式 |
|---------|---------------|---------------------|---------|
| 用户发消息 | `chat` | `human` | `POST /api/quests/:id/messages` |
| 用户手动触发执行 | `manual` | `human` | `POST /api/quests/:id/run` |
| 调度器自动触发 | `automation` | `scheduler` | 内部调度器 |

三种触发来源共享同一套 Run 生命周期，差异只在触发前的检查和完成后的回写。

---

## Run 生命周期

```
触发
  → 创建 Run（state='accepted'）
  → 更新 quest.activeRunId = run.id
  → fork AI 子进程
  → Run state='running'，记录 runnerProcessId

执行中
  → 子进程流式输出写入 run_spool
  → server 轮询 spool，通过 SSE 推送给前端

执行完成
  → 子进程退出（正常 / 失败 / 超时 / 取消）
  → finalize：spool 归一化写入历史文件（~/.pluse/runtime/quests/{questId}/events/）
  → Run state='completed'|'failed'|'cancelled'
  → 回写 Quest（见"回写逻辑"）
  → quest.activeRunId = null
  → SSE 推送 quest invalidation
  → 检查 followUpQueue（见"follow-up queue"）
```

---

## Chat Run 流程

```
POST /api/quests/:id/messages
  { text, tool, model, effort, thinking, requestId }

检查：
  1. Quest 存在且未归档
  2. requestId 幂等检查（同一 requestId 不重复创建 Run）

若 quest.activeRunId 非空：
  → 消息进入 quest.followUpQueue
  → 返回 { queued: true, position: n }

若 quest.activeRunId 为空：
  → 创建 Run { trigger: 'chat', triggered_by: 'human' }
  → 进入 Run 生命周期

执行时：
  → 读取 quest.codexThreadId 或 quest.claudeSessionId
  → 若有且 continueQuest != false：resume 已有 provider context
  → 若无或 continueQuest = false：新 provider context

完成后回写：
  → quest.codexThreadId = run.codexThreadId（若有）
  → quest.claudeSessionId = run.claudeSessionId（若有）
  → quest.updatedAt = now
  → 若 quest.autoRenamePending && 这是 Quest 的第一个 chat Run 进入终态：
      触发自动命名（见"自动命名"）
```

---

## Manual Run 流程

```
POST /api/quests/:id/run

检查：
  1. quest.kind === 'task' && quest.enabled
  2. quest.status !== 'running'
  3. quest.activeRunId 为空（否则返回 409 Conflict）

创建 Run { trigger: 'manual', triggered_by: 'human' }
更新 quest.status = 'running'
进入 Run 生命周期

完成后回写：见"task run 回写"
```

---

## Automation Run 流程

```
调度器触发（内部）：

检查：
  1. quest.kind === 'task' && quest.enabled
  2. quest.status !== 'running'（若为 running，跳过本次调度，不入队）
  3. quest.activeRunId 为空（若非空，跳过本次调度，不入队）

创建 Run { trigger: 'automation', triggered_by: 'scheduler' }
更新 quest.status = 'running'
进入 Run 生命周期

完成后回写：见"task run 回写"
```

**注意：调度跳过不入队。** 调度器如果发现 Quest 正忙，直接跳过本次触发，等下次调度窗口。原因：
- task 态通常是周期性任务，错过一次调度是可接受的
- 若入队，可能导致任务堆积（例如 Quest 长时间忙，队列中积累多次调度）
- 若需要"不错过"语义，应缩短调度间隔或使用 `once` 类型

---

## 回写逻辑

### Quest 回写（所有 Run 完成后）

```typescript
quest.codexThreadId = run.codexThreadId ?? quest.codexThreadId
quest.claudeSessionId = run.claudeSessionId ?? quest.claudeSessionId
quest.activeRunId = null
quest.updatedAt = now
```

### task run 回写（trigger = 'automation' 或 'manual'）

```typescript
// Run 成功完成（state = 'completed'）
quest.status = quest.scheduleKind === 'once' ? 'done' : 'pending'
quest.completionOutput = <最后一条 AI 输出>
quest.updatedAt = now

// Run 失败（state = 'failed'）
quest.status = 'failed'
quest.updatedAt = now

// Run 取消（state = 'cancelled'）
quest.status = 'pending'   // cancelled 不算失败，等下次调度
quest.updatedAt = now

// reviewOnComplete（仅 automation/manual run，chat run 不触发）
if quest.reviewOnComplete && run.state === 'completed':
  if quest.deleted !== true:   // Quest 未归档才创建 Todo，已归档则跳过
    create Todo {
      projectId: quest.projectId,
      originQuestId: quest.id,
      title: `Review: ${quest.title}`,
      waitingInstructions: 'Task completed. Please review the output.',
      createdBy: 'system'
    }
```

---

## Follow-up Queue

Follow-up queue 存储在 `quests.follow_up_queue`（JSON 数组），用于在 Quest 正忙时缓存 chat 消息。

```typescript
interface QueuedMessage {
  requestId: string   // 幂等键
  text: string
  tool: string
  model: string | null
  effort: string | null
  thinking: boolean
  queuedAt: string
}
```

**入队规则：**
- 只有 `chat` 触发的消息才入队
- 同一 `requestId` 不重复入队（幂等）
- 队列无上限（前端可显示队列长度）

**消费规则：**
```
Run 完成后（任意触发来源），在同一事务内：
  1. quest.activeRunId = null
  2. if quest.followUpQueue.length > 0:
       取队首，从队列中移除
       创建新的 chat Run（run.id 写入 quest.activeRunId）
```

activeRunId 清空与队首消费在同一事务内完成，避免并发导致多个 Run 同时 active。

**队列清空时机：**
- Quest 被归档时，清空队列（不再消费）
- Quest 被删除时，随 Quest 一起删除

**服务重启恢复：**
```
服务启动时：
  查询所有 quest.followUpQueue 非空的 Quest
  对每个 Quest：
    若 quest.activeRunId 为空：立即消费队首
    若 quest.activeRunId 非空：
      检查对应 Run 的状态
      若 Run 已完成但未清理（crash 导致）：清理 activeRunId，消费队首
```

---

## Automation 的 resume / fresh_context 策略

Automation 的 `executorOptions.continueQuest` 控制每次执行是否复用 Quest 的 provider context：

### continueQuest = true（默认）

```
每次执行时：
  读取 quest.codexThreadId 或 quest.claudeSessionId
  若有值：native resume
  若无值或 resume 失败：history injection 降级，不报错
```

**适用场景：**
- 需要 AI 记住之前的工作进度
- 需要 AI 基于上次结果继续推进
- 长期运行的周期性任务（如每日代码审查、持续监控）

### continueQuest = false

```
每次执行时：
  不传 resume 参数，强制新上下文
  执行完成后：
    不更新 quest.codexThreadId / quest.claudeSessionId（不污染 Quest 的主上下文）
    但仍更新 quest.completionOutput
```

**适用场景：**
- 需要每次独立、无历史包袱的执行
- 一次性任务（once）
- 需要干净上下文避免上下文污染的场景

**注意：** `continueQuest = false` 时，Automation run 完成后不更新 Quest 的 provider context id，避免影响 Quest 的 chat run 上下文。

---

## 并发约束汇总

| 操作 | Quest 有活跃 Run 时的行为 |
|------|--------------------------|
| Chat run（新消息） | 入 followUpQueue，返回 `{ queued: true }` |
| Manual run | 返回 409 Conflict |
| Automation run（调度器） | 跳过本次调度，不报错，等下次 |
| 归档 Quest | 等待活跃 Run 完成后归档（或强制取消后归档） |
| 删除 Quest | 先取消活跃 Run，再删除 |

**一个 Quest 同时只能有一个活跃写入 Run** 的原因：
- AI provider 的 quest/session 是有序的，并发写入导致上下文错乱
- `quest.activeRunId` 是乐观锁，通过数据库事务保证原子性

---

## 超时与取消

### 超时

AI provider run 默认不设置总时长超时。只有显式配置时才设置超时：

- `PLUSE_RUN_TIMEOUT_MS` / `PULSE_RUN_TIMEOUT_MS`：全局 provider run 超时，单位毫秒
- `quest.executorOptions.timeout`：task 态 provider run 超时，单位秒，优先级高于全局 provider run 超时
- script executor 默认仍为 300 秒，可通过 `executorConfig.timeout` 覆盖

触发超时后：

```text
SIGTERM → 等 15 秒 grace period → SIGKILL
Run state = 'failed', failureReason = 'timeout'
quest.status = 'failed'（仅 task 态）
```

### 取消

```
POST /api/runs/:id/cancel

  1. run.cancelRequested = true
  2. SIGTERM → runnerProcessId
  3. 等 15 秒
  4. 若进程仍存活：SIGKILL
  5. Run state = 'cancelled'
  6. quest.status = 'pending'（cancelled 不算失败，等下次调度，仅 task 态）
  7. quest.activeRunId = null
  8. 检查 followUpQueue（继续消费）
```

---

## followUpQueue UI

队列状态在前端的展示方式参考 Codex UI 风格：

- Quest 有排队消息时，输入区上方显示队列条目列表
- 每条排队消息显示内容预览，右侧有删除按钮可逐个取消
- 取消后从 `followUpQueue` 中移除，不会被执行
- 当前正在执行的 Run 不受影响

**API 支持：**
```
DELETE /api/quests/:id/queue/:requestId   # 取消单条排队消息
DELETE /api/quests/:id/queue              # 清空整个队列
```

---

## 系统提示词设计

每次 Run 执行时，系统提示词按三层顺序注入：

```
1. 系统级提示（settings 表中的 global_system_prompt）
2. 项目级提示（project.systemPrompt）
3. 执行上下文（Quest 身份信息 + pluse commands 入口）
```

**执行上下文（所有 Run 共用）：**

```
你在 Pluse 系统中运行。

当前上下文：
  项目: {projectName} ({projectId})
  工作目录: {workDir}
  Quest: {questId}

运行 `pluse commands` 查看所有可用命令，根据情况自行决定如何规划和执行。
```

**设计原则：**
- 不把所有命令硬编码进提示词，保持提示词精简
- AI 通过 `pluse commands` 按需查询能力列表
- AI 自主决定何时创建 Todo、何时查询项目状态、何时标记完成

---

## 自动命名

Quest 的 `autoRenamePending` 字段控制是否在首次 Run 完成后自动生成名称：

```
Run 完成后：
  if quest.autoRenamePending && 这是 Quest 的第一个 chat Run：
    用 fresh context 调用 AI 生成名称（基于首轮对话内容）
    成功：quest.name = 生成的名称
    失败：quest.name = 用户第一条消息的前 N 个字（截断）
    quest.autoRenamePending = false
```

**触发条件：**
- 只在 `chat` trigger 的 Run 进入终态后触发（不在 automation/manual run 后触发）
- Quest 的第一个 chat Run 进入终态后触发，不管 Run 成败
- `autoRenamePending = true` 的 Quest 才触发
- 命名失败降级为消息前 N 字，不重试，`autoRenamePending = false`

**实现约束：**
- 自动命名使用独立 fresh context，不复用 Quest 当前的 provider context
- 自动命名不会回写新的 `codexThreadId` / `claudeSessionId`，避免污染主会话上下文
- 命名长度是建议值而非硬限制：中文标题推荐 4 到 8 个字；其他语言推荐 2 到 6 个词

**初始化：** 新建 session 态 Quest 时，`autoRenamePending` 默认为 `true`。

---

## 服务启动时恢复

```
服务启动时：

1. 查询所有 state = 'accepted' 或 state = 'running' 的 Run：
   - 若 runnerProcessId 对应的进程已不存在：
       Run state = 'failed', failureReason = 'process_lost'
       quest.status = 'failed'（仅 task 态）
       quest.activeRunId = null

2. 查询所有 quest.followUpQueue 非空的 Quest：
   - 若 quest.activeRunId 为空：立即消费队首
   - 若 quest.activeRunId 非空：等待该 Run 完成后自动消费（正常流程）

3. 查询所有 enabled = true 的 Automation：
   - 重新注册调度器
   - 若 scheduleKind = 'once' 且 runAt 已过且在 1 分钟内且 status = 'pending'：立即触发
   - 若 scheduleKind = 'once' 且 runAt 过期超过 1 分钟：不触发，status 改为 'cancelled'
   - 若 scheduleKind = 'once' 且 status = 'failed'：不重新触发，保留 failed 状态
```

---

## 验收标准

### 触发来源
- [ ] `runs.trigger` 正确区分 `chat` / `manual` / `automation`

### 并发
- [ ] Quest 有活跃 Run 时，chat 消息入 followUpQueue 而非创建新 Run
- [ ] Quest 有活跃 Run 时，manual run 返回 409
- [ ] Quest 有活跃 Run 时，automation 调度跳过（不入队）
- [ ] `quest.activeRunId` 的更新在数据库事务内完成

### 回写
- [ ] Run 完成后正确更新 quest 的 provider context id
- [ ] Automation run 完成后正确更新 automation.status / completionOutput
- [ ] `continueQuest = false` 的 automation run 不更新 Quest 的 provider context id
- [ ] `reviewOnComplete = true` 时正确创建 Todo

### Follow-up Queue
- [ ] 同一 requestId 不重复入队
- [ ] Run 完成后自动消费队首
- [ ] 服务重启后恢复未消费的队列

### 服务恢复
- [ ] 启动时检测并标记 process_lost 的 Run
- [ ] 启动时重新注册 Automation 调度器
- [ ] 启动时处理过期的 once Automation
