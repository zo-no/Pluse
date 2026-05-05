# 0014 · Project Progress Panel — Phase 1 (MVP)

**状态**: draft  
**类型**: spec  
**关联 requirement**: [../requirements/0014-project-progress-panel.md](../requirements/0014-project-progress-panel.md)  
**关联 design**: [../designs/0014-project-progress-panel.md](../designs/0014-project-progress-panel.md)

---

## 本期目标

1. 新建 `progress_items` 表，支持两级层级（task → step）
2. 提供 CLI 命令：`progress create / update / list / delete`
3. 提供 HTTP API：项目维度聚合查询 + 单条 CRUD
4. 前端：项目详情页新增 Progress 面板（只读展示，按 Quest 分组）
5. 将 Progress CLI 注入 AI 的 system prompt，让 AI 在执行任务时主动写入

---

## 本期范围

### 1. 数据库：progress_items 表

```sql
CREATE TABLE IF NOT EXISTS progress_items (
  id          TEXT PRIMARY KEY NOT NULL,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  quest_id    TEXT NOT NULL REFERENCES quests(id),
  run_id      TEXT REFERENCES runs(id),
  parent_id   TEXT REFERENCES progress_items(id),
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  order_index INTEGER NOT NULL DEFAULT 0,
  deleted     INTEGER NOT NULL DEFAULT 0,
  deleted_at  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
) STRICT
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | `progress_` + 8字节随机hex |
| project_id | TEXT | 归属项目，外键 |
| quest_id | TEXT | 归属 Quest，外键 |
| run_id | TEXT? | 归属 Run（哪次执行写入的），可为空 |
| parent_id | TEXT? | 父条目 ID；null 表示顶层 task |
| title | TEXT | 步骤标题，不超过 200 字符 |
| status | TEXT | `pending` / `doing` / `done` / `skipped` |
| order_index | INTEGER | 同一 parent 下的排序，越小越靠前 |
| deleted | INTEGER | 软删除标记（0/1） |

**status 枚举**：
- `pending` — 待执行
- `doing` — 执行中（同一时刻最多一条为 doing）
- `done` — 已完成
- `skipped` — 跳过

**索引**：

```sql
-- 项目维度查询（主查询路径）
CREATE INDEX IF NOT EXISTS idx_progress_items_project
  ON progress_items (project_id, deleted, updated_at DESC)
  WHERE deleted = 0

-- Quest 维度查询
CREATE INDEX IF NOT EXISTS idx_progress_items_quest
  ON progress_items (quest_id, deleted)
  WHERE deleted = 0

-- 层级查询（子步骤查找）
CREATE INDEX IF NOT EXISTS idx_progress_items_parent
  ON progress_items (parent_id)
  WHERE parent_id IS NOT NULL AND deleted = 0
```

---

### 2. 共享类型（@pluse/types）

```typescript
export type ProgressItemStatus = 'pending' | 'doing' | 'done' | 'skipped'

export interface ProgressItem {
  id: string
  projectId: string
  questId: string
  runId: string | null
  parentId: string | null
  title: string
  status: ProgressItemStatus
  orderIndex: number
  deleted: boolean
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateProgressItemInput {
  projectId: string
  questId: string
  runId?: string
  parentId?: string
  title: string
  status?: ProgressItemStatus
  orderIndex?: number
}

export interface UpdateProgressItemInput {
  title?: string
  status?: ProgressItemStatus
  orderIndex?: number
  deleted?: boolean
}

// 前端展示用：带子步骤的聚合结构
export interface ProgressItemTree extends ProgressItem {
  children: ProgressItem[]  // 只展开一层
}
```

---

### 3. Model 层（packages/server/src/models/progress-item.ts）

提供以下函数：

```typescript
// 查询
getProgressItem(id: string): ProgressItem | null
listProgressItems(filter: {
  projectId?: string
  questId?: string
  parentId?: string | null
  status?: ProgressItemStatus
  deleted?: boolean
}): ProgressItem[]

// 写入
createProgressItem(input: CreateProgressItemInput): ProgressItem
updateProgressItem(id: string, input: UpdateProgressItemInput): ProgressItem
deleteProgressItem(id: string): boolean  // 软删除
```

---

### 4. HTTP API

路由挂载在 `/api/progress-items`（全局）和 `/api/projects/:id/progress`（项目维度）。

#### 4.1 项目维度聚合查询

```
GET /api/projects/:id/progress
```

**查询参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| questId | string? | 过滤指定 Quest |
| status | string? | 过滤状态 |
| limit | number? | 默认 100 |

**响应**：返回 `ProgressItemTree[]`，按 quest 分组后展开两级（顶层 task + 子 step）：

```json
{
  "ok": true,
  "data": [
    {
      "id": "progress_aabbcc",
      "projectId": "proj_xxx",
      "questId": "qst_yyy",
      "parentId": null,
      "title": "整理需求文档",
      "status": "doing",
      "orderIndex": 0,
      "children": [
        {
          "id": "progress_ddeeff",
          "parentId": "progress_aabbcc",
          "title": "写 requirements/0014",
          "status": "done",
          "orderIndex": 0
        },
        {
          "id": "progress_112233",
          "parentId": "progress_aabbcc",
          "title": "写 designs/0014",
          "status": "doing",
          "orderIndex": 1
        }
      ]
    }
  ]
}
```

#### 4.2 单条 CRUD

```
POST   /api/progress-items          创建
GET    /api/progress-items/:id      查询单条
PATCH  /api/progress-items/:id      更新（title / status / orderIndex）
DELETE /api/progress-items/:id      软删除
```

---

### 5. CLI 命令

注入到 `pluse` CLI，AI 在执行任务时调用这些命令写入 Progress。

#### 5.1 progress create

```
pluse progress create \
  --project-id <id> \
  --quest-id <id> \
  [--run-id <id>] \
  [--parent-id <id>] \
  --title <title> \
  [--status pending|doing|done|skipped] \
  [--order <n>] \
  [--json]
```

**输出**（默认）：
```
progress_aabbcc  整理需求文档  pending
```

**输出**（`--json`）：完整 ProgressItem JSON。

#### 5.2 progress update

```
pluse progress update <id> \
  [--title <title>] \
  [--status pending|doing|done|skipped] \
  [--order <n>] \
  [--json]
```

#### 5.3 progress list

```
pluse progress list \
  --project-id <id> \
  [--quest-id <id>] \
  [--status <status>] \
  [--json]
```

**输出**（默认，树形）：

```
qst_yyy  整理需求文档
  ✓  写 requirements/0014
  ●  写 designs/0014
  ○  写 specs/0014
```

#### 5.4 progress delete

```
pluse progress delete <id> [--json]
```

---

### 6. System Prompt 注入

在 AI 的 system prompt（任务执行上下文）中注入以下规范：

```
## Progress 记录规范

你执行任务时，必须使用以下命令维护项目的 Progress 面板：

### 开始任务时
创建顶层任务条目：
  pluse progress create --project-id <proj> --quest-id <qst> --title "<任务名称>" --status doing

### 拆解子步骤时
为每个计划步骤创建子条目：
  pluse progress create --project-id <proj> --quest-id <qst> --parent-id <task_id> --title "<步骤名称>"

### 开始执行某步骤时
  pluse progress update <step_id> --status doing

### 完成某步骤时
  pluse progress update <step_id> --status done

### 所有步骤完成，整个任务完成时
  pluse progress update <task_id> --status done

规则：
- 任务标题要简洁，反映实际目标（不超过 50 字）
- 子步骤粒度适中，每步骤对应一个有意义的操作
- 同一时刻同一任务下只有一个步骤处于 doing 状态
- 任务失败或中断时，将当前 doing 的条目更新为 pending，不要标记为 skipped
```

注入位置：`packages/server/src/runtime/` 中任务执行器的 system prompt 构建逻辑。

---

### 7. 前端 UI

#### 7.1 Progress 面板位置

项目详情页（`/projects/:id`）新增 **Progress** 标签页，与 Quests / Todos 并列。

#### 7.2 面板布局

```
[ Progress ]

▼ 开源协作空间调研  (qst_yyy)                    今天 14:32
    ✓  调研 Open Cowork 功能
    ●  整理需求文档
         ✓  写 requirements/0014
         ●  写 designs/0014
         ○  写 specs/0014

▼ API 接入百炼  (qst_zzz)                        昨天
    ✓  配置 DashScope key
    ✓  测试连通性
```

**交互规则**：
- 只读，不可点击编辑
- 顶层 task 默认展开
- 子步骤收起时显示 `(3/5 done)` 摘要
- 已完成任务（所有步骤 done）折叠显示，可点击展开
- 空状态文案：`暂无进度记录。当 AI 执行任务时，进度将自动显示在这里。`

#### 7.3 状态图标

| 状态 | 图标 | 颜色 |
|------|------|------|
| pending | ○ | gray |
| doing | ● | blue（脉冲动画） |
| done | ✓ | green |
| skipped | — | gray，删除线 |

#### 7.4 实时刷新

Phase 1 采用**轮询**（每 3 秒请求一次 `GET /api/projects/:id/progress`），仅在面板可见时轮询。Phase 2 升级为 WebSocket/SSE 推送。

---

## 迁移要求

- 无历史数据迁移，新表直接创建
- 不影响现有 Todo、Quest、Run 表

---

## 验收标准

1. `pluse progress create --project-id X --quest-id Y --title "任务A"` 能成功创建顶层条目，返回 `progress_xxx` ID
2. `pluse progress create --parent-id progress_xxx --title "步骤1"` 能创建子步骤，`parent_id` 正确关联
3. `pluse progress update progress_xxx --status doing` 能更新状态，`updated_at` 刷新
4. `pluse progress list --project-id X` 能以树形输出所有条目，按 quest 分组
5. `GET /api/projects/:id/progress` 返回 `ProgressItemTree[]`，子步骤正确嵌套在 `children` 里
6. `PATCH /api/progress-items/:id` 只更新传入的字段，未传字段不变
7. `DELETE /api/progress-items/:id` 执行软删除，`deleted=1`，后续 list 查询不返回该条目
8. 前端 Progress 面板能正确展示两级层级，doing 条目显示脉冲动画
9. 面板每 3 秒自动轮询刷新，执行中任务状态变化能及时反映
10. System prompt 注入后，AI 在新任务执行时能自动调用 `pluse progress create/update`，Progress 面板中出现对应条目

---

## 不在本期范围

- 人工编辑 Progress 条目
- WebSocket/SSE 实时推送（Phase 2）
- Progress 面板独立侧边栏入口（Phase 2）
- 按时间范围过滤（Phase 2）
- Progress 触发自动化规则
- 跨项目 Progress 汇总

---

## 推荐实现顺序

1. **DB 建表 + Model 层**（无外部依赖，先打地基）
2. **共享类型**（`@pluse/types` 里新增 ProgressItem 相关类型）
3. **CLI 命令**（最快验证数据流通路）
4. **HTTP API**（Controller + Zod 验证）
5. **System Prompt 注入**（让 AI 能自动写入）
6. **前端 Progress 面板**（最后，依赖 API 完成）
