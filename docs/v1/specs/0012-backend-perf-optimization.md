# 0012 — 后端性能优化

**状态**: draft  
**优先级**: high  
**估算**: M

## 背景

前端 SSE 连接数优化（0011）完成后，后端的热点会更集中地暴露出来。当前最值得优先处理的不是 SSE 协议本身，而是几个被高频 HTTP 补拉反复命中的路径：

1. **`GET /api/quests/:id/events` 每次都会扫描 quest 历史目录并解析事件文件**
   - 当前 `listEvents()` 使用 `readdirSync + sort + readFileSync + JSON.parse`
   - 在 `ChatView` 高频 `run_line` 场景下，这会成为最热路径
2. **`GET /api/quests/:id/runs` 当前是“全量查询后再 slice”**
   - `getQuestRunsView()` 调用 `getRunsByQuest(id).slice(0, limit)`
   - quest run 数量增长后会持续放大无效 DB 读取
3. **`GET /api/quests` 在某些 session 上会退化为“按 quest 读历史文件”**
   - `listQuestViews()` 会在 session 名称不稳定时调用 `listEvents(quest.id)` 推导列表名
   - 会话列表刷新可能变成 N 个 quest 的文件系统读取
4. **`getProjectOverview()` 不是最热路径，但当前有重复读取**
   - 实际基线不是文档里常说的 6 次，而是：
     - `getProject(id)`
     - `listQuests(session)`
     - `listQuests(task)`
     - `listTodos(projectId)`
     - `getRunsByProject(projectId, 24)`
     - `listProjectActivity(projectId, 20)`
     - `getRecentOutputs()` 内再次 `getRunsByProject(projectId, 16)`
   - 即当前是 **7 次读取，其中 runs 被查了 2 次**
5. **`listQuests` 应用层排序有成本，但不能为了下推 SQL 改变现有 mixed-kind 顺序**
   - 当前排序逻辑对 `session/session`、`task/task`、`session/task` 三种比较分支不同
   - 不能直接用一个全局 SQL `ORDER BY` 替换，否则行为会变
6. **部分索引确实缺失，但应只补“当前查询路径真的会命中”的索引**
   - `runs.state` 有明确查询命中
   - `todos.origin_quest_id`、`quests.active_run_id` 目前还没有对应的热点 SQL 过滤路径，不能先入为主定高优先级
7. **SSE 广播 O(N) fan-out 存在，但在 0011 完成后优先级会下降**
   - 每个标签页只剩 1 条全局连接时，这项收益有限
   - 在单用户/少标签场景下，通常不如前面几个热接口紧迫

## 目标

- 降低 `/api/quests/:id/events` 和 `/api/quests/:id/runs` 的单次请求成本
- 移除 `/api/quests` 列表路径上的可避免文件系统读取
- 将 `getProjectOverview()` 的重复读取从 7 次降到 5 次
- 仅补充有明确查询收益的索引
- 在不改变现有行为的前提下优化 `listQuests`

## 不在范围内

- 引入缓存层（Redis 等）
- 数据库迁移到 PostgreSQL
- 将 quest 历史事件从文件系统迁移到 SQLite
- 后端 SSE 协议变更
- `listProjectTags` 的 tags 物化表（数据量未到瓶颈）

## 方案设计

### 1. `/api/quests/:id/runs`：LIMIT 下推到 SQL（优先级最高，收益明确）

**文件：**
- `packages/server/src/models/run.ts`
- `packages/server/src/services/quests.ts`
- `packages/server/src/controllers/http/quests.ts`

当前问题：

- `getQuestRunsView(id, limit)` 目前是：

```typescript
return getRunsByQuest(id).slice(0, limit)
```

- `getRunsByQuest()` 先查出某个 quest 的全部 runs，再在应用层裁切

优化方案：

- 给 model 层增加真正支持 `LIMIT` 的读取路径，例如：

```typescript
export function getRunsByQuest(questId: string, limit?: number): Run[]
```

或新增独立函数：

```typescript
export function getRecentRunsByQuest(questId: string, limit: number): Run[]
```

- SQL 直接使用：

```sql
SELECT * FROM runs
WHERE quest_id = ?
ORDER BY created_at DESC
LIMIT ?
```

说明：

- 现有 `idx_runs_quest (quest_id, created_at DESC)` 已经覆盖这条查询
- 这里的主要问题不是缺索引，而是**没有把 limit 下推**

---

### 2. `/api/quests/:id/events`：避免目录级扫描和全量文件枚举

**文件：**
- `packages/server/src/models/history.ts`
- `packages/server/src/controllers/http/quests.ts`

当前问题：

- `listEvents()` 每次都：
  1. `readdirSync(eventsDir)`
  2. `filter(.json)`
  3. `sort()`
  4. 对 slice 后的文件逐个 `readFileSync + JSON.parse`

- 在 `ChatView` 高频补拉场景下，这条路径会反复触发
- 当前 `/api/quests/:id/events` 的 `total` 也只是 `items.length`，没有反映真实总量

优化方案：

- 复用现有 `meta.json`（`getHistoryMeta()`）中的 `latestSeq`
- 利用事件文件名是固定 9 位零填充序号格式（`000000000.json`、`000000001.json`…，`history.ts:18–20` 确认），直接生成目标范围内的文件名并读取，避免每次 `readdirSync + sort`
- 常见路径是 `offset=0`、`limit<=2000`，这时完全没有必要扫描整个目录

**当前 `total` 字段有 bug**：`quests.ts:204` 返回 `total: items.length`（已分页后的条数），而不是真实总量。优化时一并修正。

建议接口行为：

- 保持接口 shape 不变：仍返回 `PagedResult<QuestEvent>`
- 若 `meta` 可用，则：
  - `total = meta.latestSeq + 1`（`HistoryMeta` 有 `latestSeq: number`，`history.ts:29–33` 确认）
  - 根据 `offset` / `limit` 直接计算应读取的 seq 范围：`seqs = [latestSeq - offset, latestSeq - offset - 1, ..., latestSeq - offset - limit + 1]`（降序）
- 若 `meta` 缺失或发现文件不一致，再回退到当前保守实现

**注意 offset 语义**：当前 `listEvents` 的 offset 是从最旧事件（seq=0）开始算的正向偏移，即 `offset=0, limit=2000` 返回 seq 0~1999。优化后用 `latestSeq` 计算时要保持相同语义，不要变成从最新事件倒数。

这一步的目标是：

- **先降目录扫描成本**
- 不改事件存储介质
- 不引入新的 SSE 协议

---

### 3. `/api/quests`：移除列表路径上的历史文件读取

**文件：**
- `packages/server/src/services/quests.ts`
- `packages/server/src/controllers/http/quests.ts`

当前问题：

- `listQuestViews()` 在 session 名称仍是”新会话 / New Session / Untitled Session”时（`hasStableSessionName()` 判断，`quests.ts:81`），会调用：

```typescript
listEvents(quest.id)   // 无 limit，全量读取该 quest 所有事件文件
  .find(e => e.type === 'message' && e.role === 'user' && e.content?.trim())
```

- 这意味着 `/api/quests` 这个本应是 DB 列表接口的路径，在某些 session 上会退化为文件系统读取
- 最坏情况：项目有 100 个未重命名的 session，每次 `/api/quests` 就会触发 100 次 `readdirSync + JSON.parse`

优化要求：

- **不要在热列表接口里临时扫历史文件推导显示名**

可选方案：

1. 引入一个持久化的“列表展示名 / fallback name”字段，首次推导后落库
2. 复用现有 `name`，但实现时要保证不意外关闭 `autoRenamePending`
3. 如果实现复杂度过高，宁可短期接受通用标题，也不要让 `/api/quests` 在热路径上做 N 次历史文件读取

本 spec 不强行指定字段命名，但要求结果满足：

- `/api/quests` 的热路径只读 DB，不读 quest 历史文件
- 保持当前会话列表的基本可读性

---

### 4. `getProjectOverview()`：修正基线并消除重复读取

**文件：`packages/server/src/services/projects.ts`**

当前实际成本：

1. `getProject(id)`
2. `listQuests({ kind: 'session' })`
3. `listQuests({ kind: 'task' })`
4. `listTodos({ projectId })`
5. `getRunsByProject(projectId, 24)`
6. `listProjectActivity(projectId, 20)`
7. `getRecentOutputs()` 内再次 `getRunsByProject(projectId, 16)`

优化方案：

1. 合并两次 quest 查询：

```typescript
const allQuests = listQuests({ projectId: id, deleted: false })
const sessions = allQuests.filter((q) => q.kind === 'session')
const tasks = allQuests.filter((q) => q.kind === 'task')
```

2. 复用已取出的 runs，不要在 `getRecentOutputs()` 里再查一次：

```typescript
const runs = getRunsByProject(id, 24)
const recentOutputs = getRecentOutputsFromRuns(runs, sessions, tasks)
```

优化后基线：

1. `getProject(id)`
2. `listQuests({ projectId, deleted: false })`
3. `listTodos({ projectId, deleted: false })`
4. `getRunsByProject(projectId, 24)`
5. `listProjectActivity(projectId, 20)`

即从 **7 次读取降到 5 次**。

说明：

- 这仍然不是后端最热路径
- 但这是一个确定的重复读取，可以低风险消除

---

### 5. `listQuests`：只对 kind-filtered 热路径下推排序，不要强行全局 SQL 化

**文件：`packages/server/src/models/quest.ts`**

当前问题：

- `listQuests()` 先 `ORDER BY updated_at DESC` 拉出结果，再在应用层二次排序
- 但当前 comparator 是**分支式**的：
  - `session/session`：`pinned DESC`，再 `updatedAt DESC`
  - `task/task`：`scheduleKind rank`，再 `order`，再 `updatedAt DESC`
  - mixed kinds：只看 `updatedAt DESC`

这意味着：

- 一个“全局 SQL ORDER BY”很难 100% 等价复刻当前 mixed-kind 语义
- 直接替换有行为漂移风险

优化方案：

- **不要**把当前 mixed-kind comparator 直接改写成一个全局 SQL 排序
- 先只优化真正的热路径：

1. `filter.kind === 'session'`

```sql
ORDER BY pinned DESC, updated_at DESC
```

2. `filter.kind === 'task'`

```sql
ORDER BY
  CASE schedule_kind
    WHEN 'recurring' THEN 0
    WHEN 'scheduled' THEN 1
    ELSE 2
  END ASC,
  CASE WHEN order_index IS NULL THEN 1 ELSE 0 END ASC,
  order_index ASC,
  updated_at DESC
```

3. `filter.kind` 未提供

- 继续保留当前应用层 comparator，确保 mixed-kind 返回顺序完全不变

这样可以在 `SessionList`、`TodoPanel`、`ProjectOverview` 这些 kind-filtered 热路径上吃到收益，同时避免行为回归。

---

### 6. 索引：只补“有当前查询命中”的索引

**文件：`packages/server/src/db/index.ts`**

#### 立即可加

```sql
CREATE INDEX IF NOT EXISTS idx_runs_state
  ON runs (state, created_at DESC)
```

原因：

- `reconcile()` 启动时会执行：

```sql
UPDATE runs
SET ...
WHERE state IN ('accepted', 'running')
```

- 这条路径确实直接命中 `runs.state`

#### 条件成立后再加

```sql
CREATE INDEX IF NOT EXISTS idx_quests_active_run
  ON quests (active_run_id)
  WHERE active_run_id IS NOT NULL
```

前提：

- 只有在后续真的把 quest 恢复 / 清理逻辑改成 `WHERE active_run_id IS NOT NULL` 这类 SQL 路径时，这个索引才有意义
- 在当前实现下，`reconcile()` 是 `listQuests({ deleted: false })` 后在应用层判断 `activeRunId`

#### 暂缓

```sql
CREATE INDEX IF NOT EXISTS idx_todos_origin_quest
  ON todos (origin_quest_id, deleted, status)
```

原因：

- 当前 `listTodos()` 还不支持按 `originQuestId` 过滤
- 现有代码里也没有明显的热点 SQL 在用 `origin_quest_id`
- 先不要为了“未来可能会用”而加高优先级索引

---

### 7. `reconcile()`：批量清理 quest.activeRunId

**文件：`packages/server/src/services/scheduler.ts`**

当前问题：

- `runs` 的 reconcile 已经是单条批量 SQL（`scheduler.ts:20–29`，确认）
- 但 quest 清理仍是：
  - `listQuests({ deleted: false })` — 全量读取所有 quest
  - 循环判断 `quest.activeRunId`，对每个命中的 quest 调用 `updateQuest(quest.id, ...)`
  - `updateQuest()` 内部先执行 `getQuest(id)` 读取（`quest.ts:231`），再执行 UPDATE
  - 即：**每个 quest 触发 1 次 SELECT + 1 次 UPDATE**

优化方案：

```sql
UPDATE quests
SET active_run_id = NULL,
    status = CASE WHEN kind = 'task' THEN 'pending' ELSE 'idle' END,
    updated_at = ?
WHERE active_run_id IS NOT NULL
  AND deleted = 0
```

说明：

- `reconcile()` 发生在服务启动阶段，`scheduler.ts` 确认
- 当前 `updateQuest()` 在 model 层（`quest.ts`），不会自动 emit SSE；SSE 通知由 service 层调用方决定
- 批量 SQL 替换后，`reconcile()` 结束时可以查询受影响的 questId 列表，统一 emit `quest_updated` 事件
- 若启动时没有残留的 `activeRunId`（正常关闭情况），这段代码不会执行任何 UPDATE，性能无影响

这项优化是正确的，但优先级低于前面的热接口。

---

### 8. SSE 广播分桶（低优先级，0011 完成后再评估）

**文件：`packages/server/src/services/events.ts`**

当前问题：

- `emit(event)` 会遍历所有 listener
- 每个 listener 自己决定要不要丢弃事件

可选优化：

```typescript
const globalListeners = new Set<Listener>()
const listenersByProject = new Map<string, Set<Listener>>()
const listenersByQuest = new Map<string, Set<Listener>>()
```

但要注意：

- 0011 完成后，前端每个标签页只有 1 条全局 SSE 连接
- 那么大多数连接都还是会落到 `globalListeners`
- 在单用户场景下，这项收益通常不如前面的 `/events`、`/runs`、`/quests` 热路径明显

所以本项默认后置，不作为第一波优化主线。

## 实现顺序

1. `/api/quests/:id/runs`：LIMIT 下推到 SQL
2. `/api/quests/:id/events`：移除目录级 `readdir + sort` 热路径
3. `/api/quests`：去掉 `listQuestViews()` 中的历史文件读取
4. `getProjectOverview()`：合并 quest 查询并复用 runs
5. `listQuests`：仅在 kind-filtered 路径下推 SQL 排序
6. 新增 `idx_runs_state`
7. `reconcile()` 批量更新 quest
8. 视后续实现情况再评估 `idx_quests_active_run`
9. `idx_todos_origin_quest` 暂缓
10. SSE 广播分桶最后评估

## 验收标准

- [ ] `GET /api/quests/:id/runs` 不再先读取该 quest 的全部 runs 再 slice
- [ ] `GET /api/quests/:id/events` 的常见分页路径不再执行目录级 `readdir + sort`
- [ ] `GET /api/quests` 热路径不再按 session 读取历史文件推导列表名
- [ ] `getProjectOverview()` 的读取次数从 7 次降为 5 次
- [ ] kind-filtered 的 `listQuests` 顺序与当前行为一致
- [ ] mixed-kind 的 `listQuests` 顺序保持不变
- [ ] `reconcile()` 启动时不再执行 N 次 quest 循环更新
- [ ] `db/index.ts` 至少新增 `idx_runs_state`
- [ ] 现有测试通过（`packages/server/src/__tests__/`）

## 备注

- 这一轮优化的核心不是“把一切都改成 SQL”，而是**先拿掉最热路径上的全量读取**
- `getProjectOverview()` 不是当前最热接口，不应在优先级上压过 `/api/quests/:id/events`
- 如果后续要让 `ProjectPage` 跟随 quest/todo/run 做更实时的刷新，需要先重新评估 `getProjectOverview()` 的成本，不能直接把它接到所有相关 SSE 事件上
- 当前已有索引已经覆盖部分高频查询：
  - `idx_runs_quest (quest_id, created_at DESC)`
  - `idx_runs_project (project_id, created_at DESC)`
  - `idx_quests_project (project_id, kind, deleted, pinned DESC, updated_at DESC)`
  - `idx_todos_project (project_id, deleted, status, updated_at DESC)`
- 因此 0012 的重点不是“盲目补很多索引”，而是让查询形态真正利用现有索引
