# 0011 — 前端性能优化

**状态**: draft  
**优先级**: high  
**估算**: M

## 背景

当前前端存在明显的性能问题，主要表现为 UI 卡顿、响应迟缓。根因是多个组件各自独立建立 EventSource（SSE）连接，导致：

1. 同一时刻页面上可能存在 **5–6 条并发 SSE 连接**（MainPage Shell、ProjectPage、SessionList×2、TodoPanel×2、ChatView）
2. 每条连接收到事件后都触发各自的 debounce + 数据拉取，形成**连锁重渲染**
3. 部分组件存在**无 memoization 的昂贵计算**，每次渲染都重跑

## 目标

- 将全局 SSE 连接数从 5–6 条减少到 **1 条**（全局单例）
- 消除因重复连接引起的连锁重渲染
- 对高频渲染路径做 memoization，减少不必要的 React reconciliation

## 不在范围内

- 列表虚拟化（数据量未到瓶颈，暂不引入 react-window）
- 后端 SSE 协议变更
- 全局状态管理重构（不引入 Redux/Zustand）

## 已识别的前后端热点

### 热点 A：ChatView 的 `run_line` 会放大成“全量线程补拉”

这是**当前最值得单独记录的后端热点**，即使完成 SSE 单例后依然存在。

现状：

- `ChatView.refreshThread()` 每次都会并发请求：
  - `GET /api/quests/:id/events`
  - `GET /api/quests/:id/runs`
- `run_line` 事件到来后，`ChatView` 会在 200ms debounce 后触发一次 `refreshThread()`
- 运行中如果 stdout/stderr 连续输出，前端会以“每秒数次”的频率重复拉完整线程

当前实现代价：

- 前端：`ChatView.tsx:447–450` 每次都取完整 events + runs
- 前端：`ChatView.tsx:538–573` 对 `run_line` 也走同一条全量补拉路径
- 后端：`/api/quests/:id/events` 默认返回最多 2000 条事件（`controllers/http/quests.ts:197–208`）
- 后端：`listEvents()` 每次都 `readdirSync + sort + readFileSync + JSON.parse` 整个事件目录（`models/history.ts:43–64`）
- 后端：`getQuestRunsView()` 当前是 `getRunsByQuest(id).slice(0, limit)`，会先取全量 runs 再裁切（`services/quests.ts:303–305`）

结论：

- SSE 单例能消除“多条连接重复收到同一事件”的问题
- 但**不能**解决 `ChatView` 自身把高频 `run_line` 放大成高成本全量 HTTP 补拉的问题
- 这是 Phase 1 之后仍可能剩下的主要瓶颈

### 热点 B：TodoPanel 每次 reload 都有明显的 HTTP 扇出

现状：

- `TodoPanel.loadData()` 在有当前 `projectId` 时，会先拉 4 个全局列表，再拉 4 个项目列表，最后再拉 1 次 tags
- 即单次 reload 最多会触发 **8 + 1 个请求**

当前实现代价：

- `TodoPanel.tsx:228–299`：
  - 全局 active/archived tasks
  - 全局 active/archived todos
  - 当前项目 active/archived tasks
  - 当前项目 active/archived todos
  - 当前项目 tags

结论：

- SSE 单例能降低“重复触发 reload 的次数”
- 但每次 `TodoPanel` 真正 reload 时，单次成本仍偏高
- 这是另一个需要在 spec 中单独记录的热路径

### 热点 C：缺少请求失效控制，存在“过期响应覆盖新状态”的风险

现状：

- 多个页面/组件的 `loadData()` / `refresh*()` 都是直接发请求并在返回后 `setState`
- route 切换、project 切换、quest 切换时，没有统一的 `AbortController` 或 request sequence guard

影响：

- 旧请求可能在新请求之后返回，造成 stale response 覆盖当前视图
- 即使没有明显错 UI，也会产生不必要的网络和渲染开销

这既是性能问题，也是正确性问题，应在 spec 里被明确记录。

## 方案设计

### 核心：SSE 全局单例（最高优先级）

新建 `packages/web/src/views/utils/sseManager.ts`，实现一个**单例 EventSource 管理器**：

```
SseManager
  subscribe(handler, options?) — 注册事件监听，返回取消订阅函数
                                 订阅者数量从 0 变为 1 时自动建立连接
                                 订阅者数量归零时自动关闭连接
```

**设计要点：**
- 全局只保持一条 `/api/events` 连接（无 query param）
- 各组件通过 `subscribe` 注册回调，自行过滤感兴趣的 event type
- 订阅者数量归零时自动关闭连接，无需手动 connect/disconnect
- 连接断开时自动重连（指数退避，最大 30s）

**关于带 query param 的连接（`/api/events?questId=xxx`、`/api/events?projectId=xxx`）：**

服务端在 `events.ts` 中按 query param 过滤事件（仅推送匹配的 projectId/questId）。全局连接（无 query param）会收到**所有项目的所有事件**。

但有两个事件类型 **`domain_updated` 和 `domain_deleted` 的 data 中只有 `domainId`，没有 `projectId`**，客户端无法按 project 过滤。因此：

- 带 `projectId` 的连接（SessionList、TodoPanel）**不能**简单换成全局连接 + 客户端过滤，否则会收到所有项目的 domain 事件
- 带 `questId` 的连接（ChatView）可以换，因为 `run_line`/`run_updated`/`quest_updated` 都携带 `questId`，客户端可以过滤

**修订后的合并策略：**

| 原连接 | 事件类型 | 能否合并进全局连接 |
|--------|---------|-----------------|
| `/api/events?projectId=xxx`（SessionList quest 监听） | `quest_updated`, `quest_deleted` | ✅ 可以，按 projectId 过滤 |
| `/api/events`（SessionList domain 监听） | `domain_updated`, `domain_deleted` | ✅ 本来就是全局连接 |
| `/api/events?projectId=xxx`（TodoPanel） | `quest_updated`, `quest_deleted`, `todo_updated`, `todo_deleted` | ✅ 可以，按 projectId 过滤 |
| `/api/events`（TodoPanel domain 监听） | `domain_updated`, `domain_deleted` | ✅ 本来就是全局连接 |
| `/api/events?questId=xxx`（ChatView） | `quest_updated`, `run_updated`, `run_line` | ✅ 可以，按 questId 过滤 |
| `/api/events`（Shell） | `project_opened`, `project_updated` | ✅ 本来就是全局连接 |
| `/api/events`（ProjectPage） | `project_updated`, `domain_updated`, `domain_deleted` | ✅ 本来就是全局连接 |

结论：**所有连接都可以合并为 1 条全局连接**，因为 `domain_updated`/`domain_deleted` 本来就不需要按 project 过滤（所有项目共用 domain 列表），客户端只需响应任何 domain 变化即可重新拉取 domain 列表。服务端的 projectId 过滤对这两个事件类型实际上不起作用（data 中没有 projectId 字段，过滤条件 `'projectId' in event.data` 为 false，所以无论如何都会发送）。

**自动重连策略：**

当前各组件的 `source.onerror = () => source.close()` 是**直接关闭不重连**。`SseManager` 需要实现自动重连，否则网络抖动后整个应用会停止接收实时更新，比现在更差。建议指数退避：初始 1s，每次翻倍，上限 30s，重连成功后重置计时。

重连后的补拉需要**明确约定**，否则很容易出现“首次连接重复加载”或“重连后没有补数”。

建议契约：

- 服务端每次建立 SSE 连接都会先发送 `{ type: 'connected', data: { ts } }`
- `SseManager` 需要区分“首次连接成功”和“断线后的重连成功”
- 首次连接成功：**不**触发额外补拉，避免和组件自身 mount 时的全量 load 重复
- 重连成功：调用 subscriber 的 `onReconnect`，由各组件自行执行一次全量 reload
- `onReconnect` 只在经历过 `error -> retry -> connected` 后触发，不在首次 mount 时触发

**React StrictMode 兼容（重要）：**

`packages/web/src/main.tsx` 使用了 `<StrictMode>`，开发模式下 React 会故意 mount→unmount→remount 组件。若 `SseManager` 在订阅者归零时立即关闭连接，StrictMode 会导致连接在每次 unmount 时关闭、remount 时重新建立，产生连接抖动。

解决方案：订阅者归零后**延迟 200ms 再关闭连接**（用 `setTimeout`）。若在延迟期间有新订阅者加入，取消关闭计划。生产环境无影响（StrictMode 仅在开发模式生效）。

### 新增 React Hook

新建 `packages/web/src/views/hooks/useSseEvent.ts`（新建 hooks 子目录）：

```typescript
function useSseEvent(
  handler: (event: SseMessage) => void,
  options?: { onReconnect?: () => void }
): void
```

注意：类型名为 `SseMessage`（来自 `@pluse/types`），不是 `SseEvent`。

- 内部调用 `SseManager.subscribe`
- 调用方**不传 `deps`**，避免把 `useEffect` 依赖管理和重新订阅责任扩散到每个组件
- hook 内部负责保证“订阅关系稳定，但执行最新 handler”
- 项目使用 React 19（`package.json` 确认），`useEffectEvent` 可用，优先使用；回退方案是 latest-ref 模式，对外 API 不变
- 组件 unmount 自动取消订阅
- 若传入 `onReconnect`，则在 `SseManager` 判定为“重连成功”后执行一次

### 各组件改造

| 组件 | 当前连接数 | `useSseEvent` 用法 | 改造后 |
|------|-----------|-------------------|--------|
| `MainPage.tsx` Shell（`Shell` 组件，line 1049） | 1 条 `/api/events` | handler 监听 `project_opened` / `project_updated`，触发 `loadProjects()` | 改用 `useSseEvent` |
| `MainPage.tsx` ProjectPage（`ProjectPage` 组件，line 521） | 1 条 `/api/events` | handler 监听当前 `projectId` 的 `project_updated`，以及任意 `domain_*`，触发 `loadOverview()` / `loadDomains()` | 改用 `useSseEvent` |
| `SessionList.tsx`（line 152 + 172） | 2 条（project + global） | 1 次 `useSseEvent`，handler 内按 `activeProjectId` 过滤 quest 事件，同时响应任意 `domain_*` | 合并为 1 次 `useSseEvent` |
| `TodoPanel.tsx`（line 315 + 339） | 2 条（project + global） | 1 次 `useSseEvent`，handler 内按 `projectId` 过滤 quest/todo 事件，同时响应任意 `domain_*` | 合并为 1 次 `useSseEvent` |
| `ChatView.tsx`（line 538） | 1 条 `/api/events?questId=xxx` | handler 内按 `questId` 过滤；`onReconnect` 触发 `refreshQuest()` / `refreshThread()` | 改用 `useSseEvent`，客户端过滤 questId |
| `TaskDetail.tsx`（line 430） | 1 条 `/api/events?questId=xxx` | handler 内按 `questId` 过滤；`onReconnect` 触发 `loadData()` | 改用 `useSseEvent`，客户端过滤 questId |

改造后全局只有 **1 条** SSE 连接（每个浏览器标签页各 1 条，跨标签页不共享，属正常行为）。

**注意：`MainPage`（最外层）本身没有 SSE 连接**，只有 `Shell`（内层）和 `ProjectPage` 有。`MainPage` 是路由容器，不需要改造。

**`TaskDetail.tsx` 遗漏：** 初稿未包含此组件，它也有 1 条 `/api/events?questId=xxx` 连接（line 430），同样需要改造。

- 事件：`quest_updated`、`run_updated`
- pending flags：`pendingReload`、`pendingProjectRefresh`（局部变量，同 ChatView 模式，需改为 `useRef`）
- debounce：200ms
- reload 函数：`loadData()`（普通函数，捕获 `questId`）
- `onReconnect`：执行一次 `loadData()`

**各组件 reload 触发方式差异：**

| 组件 | reload 函数类型 | SSE handler 触发方式 |
|------|--------------|-------------------|
| `SessionList` | `loadQuests` 是 `useCallback`（deps: `[activeProjectId]`），SSE `useEffect` 也依赖它 | 改造后可直接在 handler 里调用 `loadQuests()` |
| `TodoPanel` | `loadData`/`loadDomains` 是普通函数，`useEffect` 依赖 `[projectId, reloadTick]` | 保留 `reloadTick` 模式：SSE handler 触发 `setReloadTick(t => t + 1)` |
| `ProjectPage` | `loadOverview`/`loadDomains` 是普通函数，每次渲染重新定义，捕获当前 `projectId` | 可直接调用，无闭包问题 |
| `Shell` | `loadProjects` 是 `useCallback`（deps: `[navigate]`） | 可直接调用 |

**注意：`onDataChanged` 现状**

- `ChatView` / `TaskDetail` 组件签名里有 `onDataChanged`
- 但当前 `Shell -> QuestRoute` 并未实际传入该 prop，因此它现在大多数场景下是 `undefined`
- 本次性能优化 **不依赖** 这条链路成立；若后续要补“详情页驱动项目概览刷新”，应单独立 spec 或在实现时顺手接通

### memoization 补充（次优先级）

**ProjectOverviewHero**（`MainPage.tsx:164–318`）：
- 用 `useMemo` 包裹 `metrics` 数组计算（依赖 `overview.sessions/tasks/waitingTodos`）
- `segments` 的计算中有可变的 `offset` 变量（`offset += rawLength`），属于副作用，**需先重构为用 `reduce` 累积偏移量的纯函数**，再包 `useMemo`
- `MainPage.tsx:255`：`style={{ background: metric.color }}` 在 metrics 循环里每次渲染创建新对象，但 metric.color 是 CSS 变量字符串，可以直接用 `style` attribute 无需 useMemo（代价极低，不优先处理）

**SessionList renderQuest**（`SessionList.tsx:358–436`）：
- 将 `renderQuest` 提取为独立组件 `QuestItem`，加 `React.memo`
- `QuestItem` 依赖的 `handlePin`、`handleArchive`、`handleRename` 等 handler 需同时用 `useCallback` 稳定引用，否则 `React.memo` 无效

**TodoPanel**（`TodoPanel.tsx:665–760`）：
- 将 `renderTodoItem` / `renderQuestItem` 提取为独立组件，加 `React.memo`
- 同样需要对传入的 handler（`handleUpdateTodo`、`handleArchiveTodo`、`handleArchiveQuest` 等）加 `useCallback`
- `questLinkState`（`TodoPanel.tsx:563`）每次渲染都调用 `taskOverlayState(location)` 创建新对象，传给 `renderQuestItem` 里的 `<Link state={questLinkState}>`——**必须用 `useMemo` 包裹**，否则 `React.memo` 完全失效
- **注意**：`TodoPanel` 已经对大量计算做了 `useMemo`（`scopeData`、`activeItems`、`historyItems`、`scopeCounts` 等），这部分不需要重复处理，只需处理 render 函数提取、handler 稳定化、questLinkState memoization

**不值得处理的 inline style（低收益，排除范围）：**
- `TodoPanel.tsx:960` `style={{ marginTop: 8 }}`、`TodoPanel.tsx:1010` `style={{ padding: '0 14px 14px' }}`
- `SessionList.tsx:592` `style={{ padding: '0 8px 8px' }}`、`TaskDetail.tsx:1142` `style={{ color: 'var(--text-muted)' }}`
- `DomainSidebar.tsx:405` `style={{ padding: '0 8px 8px' }}`
- 这些都是静态值，React reconciler 会快速跳过，实际影响可忽略，不在本次优化范围内

### debounce 时间调整

- `MainPage.tsx`、`SessionList.tsx`、`TodoPanel.tsx` 中的 120ms debounce 提升到 **300ms**
- `ChatView.tsx:529` 已是 200ms，**保持不变**（改大会让消息流响应变慢）

### 请求生命周期约束（建议补充）

对所有由路由切换或 SSE 触发的 reload，建议统一采用以下约束：

- 组件在参数变化（`projectId` / `questId`）时，应使旧请求失效
- 允许两种实现：
  - `AbortController`
  - 单调递增 request id / sequence guard，返回时只接收最新一轮响应
- 目标不是“严格取消所有请求”，而是**保证旧响应不能覆盖新状态**

这条约束优先适用于：

- `ProjectPage.loadOverview()`
- `TodoPanel.loadData()`
- `ChatView.refreshQuest()` / `refreshThread()`
- `TaskDetail.loadData()`

## 分期实施

### Phase 1：先做高收益项（SSE）

1. 实现 `SseManager` 单例（`packages/web/src/views/utils/sseManager.ts`）
2. 实现 `useSseEvent` hook（`packages/web/src/views/hooks/useSseEvent.ts`）
3. 明确 `connected` / reconnect 的补拉契约，并实现 `onReconnect`
4. 改造 **6 个组件**（Shell、ProjectPage、SessionList、TodoPanel、ChatView、**TaskDetail**），替换 EventSource 为 `useSseEvent`
5. debounce 120ms → 300ms（仅 MainPage/SessionList/TodoPanel，跳过 ChatView）

### Phase 2：再做渲染优化（memoization）

1. ProjectOverviewHero：重构 segments 为纯函数，再加 useMemo
2. QuestItem / TodoItem 提取为 React.memo 组件，同步加 useCallback
3. 检查对象型 prop 稳定性，避免 `React.memo` 被无效穿透

### Phase 3：HTTP / 后端热路径优化（按需进入）

这部分**不是当前第一优先级**，但 Phase 1 完成后如果仍感到卡顿，应优先看这里，而不是继续盲目加 memo。

1. **ChatView 增量化**
   当前 `run_line` 会触发完整 thread reload。后续应在以下方向中选一个：
   - 新增按 `seq` 增量拉取 events 的接口
   - 前端对 `run_line` 先做本地追加，仅在 `run_updated` / `quest_updated` 时全量补拉
   - 为 runs 提供真正带 `LIMIT` 的查询，而不是先全量取再 slice
   这一步大概率会触及后端 API 设计，因此不放进本次 Phase 1。

2. **TodoPanel 数据整形**
   目标是减少单次 reload 的 8+1 请求扇出。可选方向：
   - 按当前激活 scope 懒加载，而不是总是同时拉 global + project
   - 对 untouched scope 做短时缓存
   - 新增聚合接口，一次返回 rail 需要的数据切片

3. **ProjectOverview 轻量化**
   当前 `getProjectOverview()` 每次都会重新组装 sessions/tasks/todos/activity/outputs（`services/projects.ts:345–368`）。
   只要它仍然不是高频 reload 点，这不是瓶颈；但如果未来想让项目概览跟随 quest/todo/run 实时刷新，**不要直接把它接到所有相关 SSE 事件上**，而应先设计轻量 summary endpoint 或更细粒度的 reload 策略。

4. **请求失效控制**
   若 Phase 1 实现时未顺手补齐，至少应在这一阶段统一加上 abort / sequence guard。

## 实现顺序

默认按 Phase 1 → Phase 2 执行；若 Phase 1 完成后 profiler 显示卡顿已显著缓解，可单独评估是否继续推进 Phase 2。

若 Phase 1 完成后“连接数已降到 1，但运行中 ChatView 仍卡、TodoPanel reload 仍重”，应优先进入 **Phase 3**，而不是继续在 UI 层堆 memo。

## 验收标准

- [ ] 浏览器 DevTools Network 面板中，同一标签页的 `/api/events` 连接数在有业务订阅者时始终为 1
- [ ] 切换 project、打开 ChatView 不新增 SSE 连接
- [ ] 切换到 `/settings` 不新增额外 SSE 连接；若 `Shell` / 侧栏 / 右侧任务面板仍挂载，连接继续存在属正常行为
- [ ] 当所有 SSE 订阅者都取消订阅后，`/api/events` 连接关闭
- [ ] 现有功能（实时更新、任务状态同步）行为不变
- [ ] SSE 断线后可自动重连；重连成功后各订阅组件会执行一次全量 reload
- [ ] ProjectOverviewHero 在数据未变时不重新计算 metrics/segments
- [ ] ChatView 消息流实时响应不受影响（debounce 仍为 200ms）

## 度量建议

- Phase 1 至少记录一次对比：优化前后，同一次 quest/run/todo 事件 burst 触发的 reload 次数
- 若要进入 Phase 2，建议先用 React Profiler 或 Performance 面板确认瓶颈确实在 render，而不只是 SSE 风暴
- 若要进入 Phase 3，建议额外记录：
  - `run_line` 密集输出时，`ChatView` 每秒触发多少次 `/api/quests/:id/events`
  - 单次 `TodoPanel.loadData()` 实际触发的请求数
  - `/api/quests/:id/events` 返回条数与响应耗时的关系

## 备注

- 服务端 `/api/events` 的 query param 过滤逻辑可保留，不需要删除，只是前端不再使用
- `SseManager` 不依赖 React，放在 `views/utils/` 下作为纯 TS 模块（`lib/` 目录不存在，勿新建）
- `MainPage`（最外层路由容器）无 SSE 连接，不在改造范围内
- `/settings` 仍运行在 `Shell` 内，不是“无业务组件的纯净页”；不要把“进入设置页”与“关闭 SSE”绑定
- `TodoPanel` 已有大量 `useMemo`，memoization 工作量比 spec 初稿估计的小
- `ChatView` 的 pending flag 模式（`pendingQuestRefresh` 等局部变量）在改用全局 handler 后需要用 `useRef` 替代，因为 handler 是闭包，局部变量无法跨事件累积（已验证：当前模式依赖 useEffect 内同一 onmessage 实例的闭包状态，subscriber 模式下每次调用是独立闭包，flags 会被重置）
- 完整 SSE 事件类型（共 11 种）：`connected`、`project_opened`、`project_updated`、`domain_updated`、`domain_deleted`、`quest_updated`、`quest_deleted`、`todo_updated`、`todo_deleted`、`run_updated`、`run_line`
- `connected` 事件服务端在每次建立连接时都会发送；`SseManager` 需要据此区分首次连接与重连，并通过 `onReconnect` 把补拉责任交给组件
- `domain_updated` 和 `domain_deleted` 的 data 中没有 `projectId`，但这不影响全局连接方案——这两个事件本来就应该全局响应（重新拉取 domain 列表），服务端对这两个类型的 projectId 过滤实际上也不生效
- `ProjectPage` 当前只监听 `project_updated` / `domain_*`，并不会因为 quest/todo/run 变化而实时刷新；如果未来要补这条链路，必须先评估 `getProjectOverview()` 的服务端成本，不能直接把所有相关 SSE 事件都接上去
