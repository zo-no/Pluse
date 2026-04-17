# MelodySync × Conductor 集成设计

## 背景

MelodySync 负责 AI 对话（Session / Run），conductor 负责任务调度（Task / Scheduler）。
两个系统同机器运行，共享同一用户的本地文件系统。

目标：在 MelodySync 的聊天界面里展示和操作 conductor 的任务，让项目 Agent 模型成立。

---

## 核心原则

**conductor 是 Task 的唯一真值来源。**

- MelodySync 不复制 task 数据到自己的 db
- MelodySync 通过 conductor HTTP API 读写 task
- conductor 的调度器（scheduler）继续独立运行，不受影响

---

## 数据模型对齐

### 问题：两套 Project id

两个系统各自有 `projects` 表，id 互不相知：

```
MelodySync:  projects.id = 'proj_abc123'   (~/.melodysync/runtime/sessions.db)
conductor:   projects.id = 'proj_def456'   (~/.conductor/db.sqlite)
```

### 解决：MelodySync Project 加 conductorProjectId 字段

```sql
-- MelodySync sessions.db migration
ALTER TABLE projects ADD COLUMN conductor_project_id TEXT;
CREATE INDEX IF NOT EXISTS idx_projects_conductor ON projects(conductor_project_id);
```

```typescript
// packages/types/src/index.ts 新增
interface Project {
  // ... 现有字段
  conductorProjectId?: string  // 关联的 conductor project id
}
```

### 创建项目时的双写流程

```
用户在 MelodySync 创建项目（填写名称、路径、目标）
  → MelodySync POST /api/projects（自己的 db）
  → MelodySync 调 conductor POST /api/projects（conductor db）
      body: { name, goal, workDir: path }
  → 把返回的 conductor project id 存入 conductor_project_id
```

如果 conductor 未运行，`conductorProjectId` 为空，功能降级（不显示 task 面板）。

---

## 任务读取：MelodySync 查 conductor API

MelodySync 前端通过 MelodySync server 做代理（避免前端直接跨域调 conductor）：

```
前端 → GET /api/conductor/tasks?projectId=<conductorProjectId>&assignee=human&status=pending
  → MelodySync server 转发 → conductor GET /api/tasks?projectId=...&assignee=human&status=pending
  → 返回 Task[]
```

代理路由挂在 MelodySync server 上：

```typescript
// packages/server/src/controllers/http/conductor-proxy.ts
// 转发所有 /api/conductor/* 到 conductor HTTP API
// conductor 默认端口：7762
```

---

## 任务写入：通过 conductor API

所有 task 写操作走 conductor API（保证 scheduler 感知到变更）：

| 操作 | conductor 端点 |
|------|---------------|
| 创建 task（AI 派给人） | `POST /api/tasks` |
| 标记 done | `POST /api/tasks/:id/done` |
| 取消 | `POST /api/tasks/:id/cancel` |
| 更新描述 | `PATCH /api/tasks/:id` |

---

## UI 结构

### 聊天页面布局（新增右侧栏）

```
┌──────────────────┬─────────────────────────────┬──────────────────┐
│ 侧边栏 (280px)   │ 聊天区域                      │ 任务栏 (260px)   │
│                  │                              │                  │
│ [项目名称 ▾]     │ 顶栏：会话名 + model badge    │ [全部] [本项目]  │
│ ─────────────── │ ──────────────────────────── │ ──────────────── │
│ + 新建会话       │                              │ ▸ 待处理 (3)     │
│ ─────────────── │ 消息历史                      │   □ 审核部署计划  │
│ 会话 1          │                              │     来自 AI · 2h │
│ 会话 2          │                              │   □ 确认 API key  │
│ 会话 3          │                              │     来自 AI · 1d │
│                  │ ──────────────────────────── │ ──────────────── │
│                  │ 输入区                        │ ▸ 已完成 (12)    │
└──────────────────┴─────────────────────────────┴──────────────────┘
```

右侧栏默认显示，可折叠（存 localStorage）。

### 任务栏视图切换

- **全部**：当前用户所有项目的 `assignee=human` 任务，按 `created_at DESC`
- **本项目**：仅当前 session 所属项目的任务

### 任务卡片

```
□  审核部署计划
   来自 AI · melody-sync-v2 · 2小时前
   [完成] [忽略]
```

- `□` 点击 = 标记 done（调 `POST /api/conductor/tasks/:id/done`）
- [忽略] = 取消（调 `POST /api/conductor/tasks/:id/cancel`）
- 点击卡片主体 = 展开 `waitingInstructions`（AI 写的说明）

### 项目管理页（新增周期任务入口）

```
项目列表
  └── 点击项目 → 项目详情
        ├── 基本信息（名称、路径、目标）
        └── 周期任务列表（kind=recurring/scheduled，来自 conductor）
              ├── 每日站会 · 每天 09:00 · 运行中
              └── 周报整理 · 每周五 18:00 · 待运行
```

---

## AI 在对话中创建任务

AI 通过 conductor 的 MCP tool 或直接调 CLI 创建 task。

MelodySync 在 session 的 system prompt 里注入当前项目的 conductor project id：

```
你的当前项目 ID（conductor）：proj_def456
如需给用户派任务，调用：conductor task create --project proj_def456 --assignee human --title "..." --instructions "..."
如需创建周期任务，调用：conductor task create --project proj_def456 --assignee ai --kind recurring --cron "0 9 * * *" --title "..." --prompt "..."
```

任务创建后，conductor 的 SSE 事件流（`/api/events`）会推送 `task_created` 事件，
MelodySync 前端监听后刷新右侧任务栏。

---

## 实时更新

conductor 有 SSE 事件流：`GET /api/events`（已实现）。

MelodySync 前端订阅 conductor 的事件流，监听 `task_created` / `task_updated` / `task_deleted`，
触发任务栏刷新。

```typescript
// packages/web/src/controllers/tasks.ts
// 订阅 conductor SSE，维护任务列表 Zustand store
```

---

## 实现步骤（按顺序）

### Step 1：数据层打通
- [ ] MelodySync `projects` 表加 `conductor_project_id` 列
- [ ] 创建项目时同步调 conductor 创建对应项目
- [ ] `packages/types` 的 `Project` 类型加 `conductorProjectId`

### Step 2：conductor 代理路由
- [ ] `packages/server/src/controllers/http/conductor-proxy.ts`
- [ ] 转发 `/api/conductor/*` → `http://localhost:7762/api/*`
- [ ] 挂载到 MelodySync server

### Step 3：任务 Zustand store
- [ ] `packages/web/src/controllers/tasks.ts`
- [ ] `fetchTasks(projectId?, assignee?)` — 拉取任务列表
- [ ] `markDone(taskId)` / `cancelTask(taskId)`
- [ ] 订阅 conductor SSE 实时更新

### Step 4：右侧任务栏 UI
- [ ] `packages/web/src/views/components/TaskPanel.tsx`
- [ ] 全部 / 本项目 视图切换
- [ ] 任务卡片（标题、来源、时间、操作按钮）
- [ ] 折叠/展开（localStorage 记忆状态）

### Step 5：MainPage 布局调整
- [ ] 三列布局：侧边栏 + 聊天区 + 任务栏
- [ ] 任务栏可折叠

### Step 6：system prompt 注入
- [ ] Session 启动时，把 `conductorProjectId` 注入 system prompt
- [ ] 告知 AI 如何调用 conductor CLI 创建任务

### Step 7：项目管理页周期任务入口
- [ ] 项目详情页展示 `kind=recurring/scheduled` 的任务列表

---

## conductor 服务发现

MelodySync 通过环境变量找到 conductor：

```
CONDUCTOR_URL=http://localhost:7762   # 默认值
```

如果 conductor 未运行，代理路由返回 503，前端任务栏显示"conductor 未连接"提示，
不影响聊天核心功能。

---

## 不做的事（明确边界）

- MelodySync 不实现自己的 task 调度器
- MelodySync 不复制 task 数据到本地 db
- MelodySync 不管理 conductor 的生命周期（不负责启停）
- 跨设备同步不在本期范围内
