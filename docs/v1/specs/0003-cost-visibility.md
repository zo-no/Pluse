# 0003 — 成本可见性

**状态**: approved  
**优先级**: high  
**估算**: M

## 背景

Pluse 每次 AI 调用（Run）都会消耗 token，但目前这些数据几乎完全丢失：

- Claude 返回的 `usage` 对象（含 input/output/cache_read/cache_creation tokens）只被转成展示字符串，没有持久化
- `runs` 表虽已预留 `context_input_tokens` / `context_window_tokens` 字段，但从未写入
- 没有成本数据持久化（Claude CLI 的 `result` 事件包含 `total_cost_usd` 字段，但从未被读取）
- 前端完全没有 token / cost 展示

用户无法知道一次对话花了多少钱，也无法通过数据驱动成本优化。

## 目标

1. 每次 Run 完成后，将 token 消耗（input / output / cache_read / cache_creation）持久化到数据库
2. 前端在 Run 完成后即时展示本次 token 消耗和估算成本（会话态 + 任务态均支持）
3. Project 概览页展示总 token 用量和估算成本（懒加载，不阻塞概览渲染）
4. 为后续成本优化提供数据基础（缓存命中率、历史注入成本等）

## 不在范围内

- Codex 的 token 统计（Codex CLI 当前不输出 usage 数据，暂不支持）
- Quest 维度的累计 token 统计（留到下一个迭代，MVP 只做 Run 级别和 Project 级别）
- 成本预算 / 告警功能
- 精确到 tool_use 级别的 token 拆分
- 价格的 UI 配置界面（直接使用 CLI 返回的实际成本，不需要价格表）

## 方案设计

### 数据流

```
Claude CLI 输出 result 事件（含 usage + total_cost_usd）
  → parseClaudeLine 提取 4 个 token 字段 + total_cost_usd
  → attempt() 通过 ProviderAttemptResult 携带
  → executeProviderRun 在 finalizeRun 前写入 DB
  → updateRun 更新 runs 表（input_tokens / output_tokens / cache_* / cost_usd）
  → 前端通过 runs API 读取展示
```

> **设计依据**：Claude CLI 的 `result` 事件直接包含 `total_cost_usd` 字段（经实测验证，2026-04），无需维护价格表。直接持久化 CLI 返回的成本，永远准确，不随 Anthropic 调价而失效。

### 后端变更

#### 1. 数据库 schema（`packages/server/src/db/index.ts`）

在现有 `ensureColumn` 块末尾追加，利用现有安全迁移机制（不破坏已有数据）：

```ts
ensureColumn(db, 'runs', 'input_tokens',           'ALTER TABLE runs ADD COLUMN input_tokens INTEGER')
ensureColumn(db, 'runs', 'output_tokens',          'ALTER TABLE runs ADD COLUMN output_tokens INTEGER')
ensureColumn(db, 'runs', 'cache_read_tokens',      'ALTER TABLE runs ADD COLUMN cache_read_tokens INTEGER')
ensureColumn(db, 'runs', 'cache_creation_tokens',  'ALTER TABLE runs ADD COLUMN cache_creation_tokens INTEGER')
ensureColumn(db, 'runs', 'cost_usd',               'ALTER TABLE runs ADD COLUMN cost_usd REAL')
```

> 注1：现有的 `context_input_tokens` / `context_window_tokens` 字段语义不同（上下文窗口大小），保留不变。
> 注2：`cost_usd` 直接来自 Claude CLI `result` 事件的 `total_cost_usd` 字段，Codex 无此字段时为 null。

#### 2. 类型定义（`packages/types/src/run.ts`）

`Run` interface 新增 5 个可选字段：

```ts
inputTokens?: number
outputTokens?: number
cacheReadTokens?: number
cacheCreationTokens?: number
costUsd?: number
```

#### 3. 聚合类型（`packages/types/src/api.ts`）

新增（仅 `TokenUsageSummary`，`ProjectOverview` 不变）：

```ts
export interface TokenUsageSummary {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  runCount: number
  costUsd: number | null  // 直接来自 CLI 的 total_cost_usd 累加；Codex run 无此数据时为 null
}
```

`ProjectOverview` 不新增 `tokenUsage` 字段（见步骤 7 说明，改为独立端点懒加载）。

#### 4. Run 模型层（`packages/server/src/models/run.ts`）

- `RunRow` 类型新增 5 个字段（4 个 `number | null` + `cost_usd: number | null`）
- `rowToRun` 映射新字段
- `updateRun` 的 `fieldMap` 追加 5 对映射
- 新增一个聚合查询函数：

```ts
// 按 project 汇总，只统计 state='completed' 且 input_tokens IS NOT NULL 的 Run
// 直接返回单个汇总对象（cost_usd 直接 SUM，无需按模型分组计算）
export function getProjectTokenSummary(projectId: string): {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  costUsd: number | null
  runCount: number
}
```

SQL：
```sql
SELECT
  SUM(input_tokens)          AS input_tokens,
  SUM(output_tokens)         AS output_tokens,
  SUM(cache_read_tokens)     AS cache_read_tokens,
  SUM(cache_creation_tokens) AS cache_creation_tokens,
  SUM(cost_usd)              AS cost_usd,
  COUNT(*)                   AS run_count
FROM runs
WHERE project_id = ?
  AND state = 'completed'
  AND input_tokens IS NOT NULL
```

> `cost_usd` 直接来自 CLI，已按实际模型定价计算，无需 `(tool, model)` 分组。`SUM(cost_usd)` 在有 null 值时仍返回非 null 值（SQLite SUM 忽略 null），若全为 null 则返回 null，符合预期。

#### 5. 定价服务（**不需要创建**）

经实测验证（2026-04），Claude CLI 的 `result` 事件直接包含 `total_cost_usd` 字段，已按实际模型定价精确计算：

```json
{
  "type": "result",
  "total_cost_usd": 0.2332025,
  "usage": {
    "input_tokens": 3,
    "cache_creation_input_tokens": 37274,
    "cache_read_input_tokens": 0,
    "output_tokens": 9
  }
}
```

直接持久化 `total_cost_usd` 到 `runs.cost_usd`，无需维护价格表，永远准确。`pricing.ts` 不需要创建，`catalog.ts` 保持不变。

#### 6. token 数据采集核心（`packages/server/src/runtime/session-runner.ts`）

**6a. 扩展 `ProviderParseResult` 类型**

新增字段：
```ts
tokenUsage?: {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  costUsd: number | null
}
```

**6b. 修改 `parseClaudeLine` 的 result 分支**

Claude CLI 在 `result` 事件中返回以下字段（经实测验证）：
- `usage.input_tokens`
- `usage.output_tokens`
- `usage.cache_read_input_tokens`（非 `cache_read_tokens`）
- `usage.cache_creation_input_tokens`（非 `cache_creation_tokens`）
- `total_cost_usd`（顶层字段，非 usage 内）

从 `result` 对象提取全部 5 个字段，映射到内部命名，设置 `parsed.tokenUsage`：

```ts
if (obj.type === 'result') {
  const usage = obj.usage && typeof obj.usage === 'object' ? obj.usage as Record<string, unknown> : {}
  const hasTokens = typeof usage.input_tokens === 'number'
  if (hasTokens) {
    tokenUsage = {
      inputTokens: usage.input_tokens as number,
      outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
      cacheReadTokens: typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0,
      cacheCreationTokens: typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0,
      costUsd: typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : null,
    }
  }
  // makeUsageEvent 保持不变（usage event 在步骤 9 中被过滤，不可见）
  events.push(makeUsageEvent([...]))
  providerError = normalizeProviderError(obj.error)
}
```

**6c. 扩展 `ProviderAttemptResult` 类型**

新增 `tokenUsage?` 字段。

`capturedTokenUsage` 必须声明在 `attempt()` 函数体**内部**（每次调用独立变量），而非外层 `executeProviderRun` 作用域。若声明在外层，retry 时两次 attempt 共享同一变量，firstAttempt 的 tokenUsage 会污染 fallbackAttempt 的结果：

```ts
const attempt = (nativeResume: boolean): Promise<ProviderAttemptResult> => new Promise((resolve) => {
  // ✅ 声明在 attempt() 内部，每次调用独立
  let capturedTokenUsage: ProviderAttemptResult['tokenUsage']

  wireLineStream(child.stdout, (line) => {
    const parsed = parseProviderLine(tool, line)
    if (parsed.tokenUsage) capturedTokenUsage = parsed.tokenUsage
    // ...其余处理不变
  })

  child.once('close', (code, signal) => {
    // 所有 resolve 路径都携带 tokenUsage
    resolve({ state: 'completed', assistantText: lastAssistantText, tokenUsage: capturedTokenUsage })
    // （其他路径同理）
  })
})
```

无竞态问题：`wireLineStream` 的回调和 `close` 事件均在同一 Node.js 事件循环线程中串行执行，`close` 必然在所有 `data` 事件之后触发。

实现时注意：`close` 事件处理器有 **5 个 `resolve()` 调用路径**（completed / failed / cancelled / timeout / error），每个路径都需要携带 `tokenUsage: capturedTokenUsage`（undefined 时类型安全，`updateRun` 会跳过空字段）。`error` 事件路径（spawn 失败）无 tokenUsage，传 `undefined` 即可。

**6d. 在 `executeProviderRun` 中写入数据库**

在所有 `finalizeRun` 调用之前，若 attempt 结果有 `tokenUsage` 则先调用 `updateRun(runId, attempt.tokenUsage)`。

所有状态路径均写入（不只是 completed）：
- **completed**：正常写入
- **failed**：Claude 可能在失败前已输出 result 事件，tokenUsage 有值时也写入，保留部分数据
- **cancelled**：同上，取消前已输出的 usage 数据也写入

retry 路径处理：
- `firstAttempt.retryWithHistory === true` 时，第一次 attempt 的 tokenUsage 丢弃
- 取 `fallbackAttempt.tokenUsage`（最终执行结果）写入数据库
- 若 fallbackAttempt 也没有 tokenUsage（例如 Claude 未返回 result 事件），token 字段保持 null

#### 7. 聚合 API 端点

**本 spec 不新增 `/quests/:id/token-summary` 端点**（Quest 累计统计留到下一个迭代）。

**修改 `packages/server/src/services/projects.ts`**

`getProjectOverview` 已有 6 次 DB 查询，不在此函数内再追加聚合查询，避免概览页进一步变重。

改为：`tokenUsage` 字段**不放入** `getProjectOverview`，前端单独调用 `GET /projects/:id/token-summary` 懒加载。

**同步新增 `GET /projects/:id/token-summary` 端点**（挂在 `projectsRouter`，`packages/server/src/controllers/http/projects.ts`），调用 `getProjectTokenGroups`，对各分组 `estimateCostUsd` 后汇总返回 `TokenUsageSummary`。

> `ProjectOverview` 类型**不新增** `tokenUsage` 字段，前端通过独立 API 获取，与概览数据解耦。

### 前端变更

#### 8. API 客户端（`packages/web/src/api/client.ts`）

新增（懒加载，不随概览数据一起请求）：
```ts
export function getProjectTokenSummary(id: string): Promise<ApiResult<TokenUsageSummary>>
```

> `getQuestTokenSummary` 留到下一个迭代（Quest 累计统计不在本 spec 范围内）。

#### 9. Run 完成后即时展示（`packages/web/src/views/components/ChatView.tsx`）

ChatView 已有 `usage` 类型的 `QuestEvent`，目前在 `describeMetaEvent` 里被归类为普通 meta 事件展示字符串（`"input 1500 · output 800"`）。本 spec 实现后，**结构化展示走 Run 字段，meta 区域的 usage event 字符串同步废弃隐藏**，避免重复展示。

具体：在 `buildThreadSegments` 中，将 usage event 从 `pendingMeta` 数组中过滤掉（不加入分组），而非在渲染层处理。原因：`describeMetaEvent` 当前返回类型不允许 null，若只在渲染层跳过，meta group 里仍会有空洞元素影响布局。结构化数据改从 Run 对象的 `inputTokens` 等字段读取。

**精确放置位置**：composer 区域的 `pluse-composer-mainline` 内已有一个 `pluse-inline-status pluse-inline-status-compact` div，其中包含"上次：{{state}}"的 `<span>`。在该 `<span>` 之后，`latestRun.state !== 'running'` 且 `latestRun.inputTokens` 有值时，追加一个 token span：

```tsx
{latestRun && latestRun.state !== 'running' && latestRun.inputTokens != null ? (
  <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
    {`↑${formatTokenCount(latestRun.inputTokens)} ↓${formatTokenCount(latestRun.outputTokens ?? 0)}`}
    {latestRun.cacheReadTokens ? ` · ↩${Math.round(latestRun.cacheReadTokens / (latestRun.inputTokens + latestRun.cacheReadTokens + (latestRun.cacheCreationTokens ?? 0)) * 100)}%` : ''}
  </span>
) : null}
```

格式（Run 完成且有 token 数据时，追加在"上次：completed"之后）：

```
上次：completed  ↑1.2k ↓0.8k · ↩42%
```

- `formatTokenCount(n)`：`>= 1000` 显示为 `1.2k`，否则直接显示数字
- 缓存命中率（有 `cacheReadTokens` 时显示）：`cacheReadTokens / (inputTokens + cacheReadTokens + cacheCreationTokens)`，格式 `↩42%`
- Run 列表通过现有 `getQuestRuns` API 获取，已包含新增的 token 字段，无需新增 API

#### 9b. TaskDetail 的 token 展示（`packages/web/src/views/components/TaskDetail.tsx`）

TaskDetail 已有「运行记录」区域，每条 Run 记录的 `<p>` 元素展示：`{run.tool}/{run.model} · {trigger} · {time}`。

**精确放置位置**：在该 `<p>` 末尾追加 token 信息，Run 完成且有 `inputTokens` 时：

```tsx
<p>
  {run.tool}/{run.model} · {formatTrigger(run.trigger, t)} · {formatDateTime(run.createdAt, locale, t)}
  {run.inputTokens != null ? (
    <span style={{ color: 'var(--text-muted)' }}>
      {` · ↑${formatTokenCount(run.inputTokens)} ↓${formatTokenCount(run.outputTokens ?? 0)}`}
      {run.cacheReadTokens ? ` · ↩${Math.round(run.cacheReadTokens / (run.inputTokens + run.cacheReadTokens + (run.cacheCreationTokens ?? 0)) * 100)}%` : ''}
    </span>
  ) : null}
</p>
```

与 ChatView 复用相同的 `formatTokenCount` helper（提取到共享 utils 文件，或在两个组件内各自声明）。

#### 10. Project 概览页（`packages/web/src/views/pages/MainPage.tsx`）

概览页主体渲染完成后，异步调用 `getProjectTokenSummary(projectId)` 懒加载 token 数据（独立 `useState`，不阻塞主体渲染）。

在 `ProjectOverviewHero` 的 aside 区域，`tokenSummary` 有数据且 `runCount > 0` 时展示：

```
Token 消耗
  12.4M        $1.23
```

复用现有 `pluse-overview-aside-item` CSS 类，与"最近活动"、"已完成"保持视觉一致。数据加载中或无数据时该区域不显示（静默等待，不展示 loading 骨架）。

## 实现顺序

**第一阶段（数据管道，后端，无 UI 变化）**

1. DB schema（步骤 1）
2. 类型定义（步骤 2、3）
3. Run 模型层（步骤 4）
4. token 采集核心（步骤 6）—— 完成后每次 Claude Run 都会记录 token 数和成本

**第二阶段（展示）**

6. 聚合 API（步骤 7，`/projects/:id/token-summary`；`/quests/:id/token-summary` 留到下一个迭代）
7. 前端 API 客户端（步骤 8，`getProjectTokenSummary`）
8. Run 完成后即时展示（步骤 9，最高优先级）
   - `buildThreadSegments` 过滤 usage event（ChatView）
   - ChatView token pill
   - TaskDetail token pill（复用相同 helper）
9. Project 概览懒加载（步骤 10）

## 验收标准

**数据采集**
- [ ] 跑完一次 Claude 对话后，`SELECT input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens FROM runs ORDER BY created_at DESC LIMIT 1` 有非 null 值
- [ ] cache token 采集验证（需两轮对话）：第一轮产生 `cache_creation_tokens > 0`，第二轮同一会话产生 `cache_read_tokens > 0`
- [ ] Codex Run 完成后上述 4 个字段均为 null
- [ ] retry 路径（session 过期回退历史注入）token 数据取最终 attempt 的值，而非第一次 attempt

**前端展示**
- [ ] ChatView composer 底部"上次：completed"后追加 token span（`↑1.2k ↓0.8k`），不侵入现有布局
- [ ] 有缓存命中时显示缓存命中率（`↩42%`）
- [ ] Codex Run 完成后不展示 token span（`inputTokens` 为 null，静默处理）
- [ ] ChatView 的 meta 区域不再出现 usage event 字符串（已在 `buildThreadSegments` 中过滤）
- [ ] TaskDetail 运行记录 `<p>` 末尾追加 token 信息（`· ↑1.2k ↓0.8k · ↩42%`）

**聚合与概览**
- [ ] `GET /projects/:id/token-summary` 返回正确的汇总数据（`costUsd` 直接 SUM CLI 返回值）
- [ ] Project 概览页有数据时出现 Token 用量 aside 指标，无数据时不显示

## 备注

- Codex CLI 目前不输出 usage 数据，`parseCodexLine` 不做修改，token 字段和 `cost_usd` 保持 null
- `context_input_tokens` / `context_window_tokens` 是另一组字段（上下文窗口大小），与本 spec 的 5 个字段并存，语义不同
- Claude API 返回的字段名是 `cache_read_input_tokens` / `cache_creation_input_tokens`，内部存储简化为 `cache_read_tokens` / `cache_creation_tokens`，实现时注意映射
- `total_cost_usd` 直接来自 Claude CLI `result` 事件，已按实际模型定价计算，无需维护价格表。`pricing.ts` 不需要创建
- 现有 `usage` 类型 QuestEvent 的 meta 展示在前端实现时废弃，通过在 `buildThreadSegments` 中过滤 usage event 实现（不改 `describeMetaEvent` 返回类型），改由 Run 字段的结构化展示替代
- ChatView 和 TaskDetail 的 token span 只展示 token 数量和缓存命中率（不展示 cost）；cost 通过 Project 概览的 `GET /projects/:id/token-summary` 端点展示（`costUsd` 字段直接 SUM 各 Run 的 `cost_usd`）
- 本 spec 完成后，可基于采集到的 `cache_read_tokens` 数据分析缓存命中率，为下一步成本优化（0004-cost-optimization）提供依据
