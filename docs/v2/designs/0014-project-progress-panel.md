# 0014 · Project Progress Panel — Design

> Requirement: [0014-project-progress-panel.md](../requirements/0014-project-progress-panel.md)

## 一、能力边界

### 本设计解决的问题

每个项目维护一个持久的 **Progress 面板**，聚合展示该项目下 AI 执行任务的分解步骤和当前进度。

用户的核心诉求：
1. **执行中实时可见** — AI 跑任务时，面板同步展示每一个子步骤的状态
2. **跨会话持久** — 关掉对话重新打开，上次的进度记录还在
3. **项目级聚合** — 同一项目下多个 Quest 的进度汇聚在一起
4. **历史可查** — 之前完成的任务也保留

### 不在边界内

- 人工编辑 Progress 条目（本期只由 AI 写入）
- Progress 触发自动化（本期只读）
- 跨项目汇总

---

## 二、关键对象

### 新对象：ProgressItem（进度条目）

Progress 面板的最小单元。**不是 Todo**，也不是 Run——它是 AI 执行过程中自动产生的结构化进度记录。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | progress_xxx |
| project_id | string | 归属项目 |
| quest_id | string | 归属 Quest（哪次任务产生的） |
| run_id | string? | 归属 Run（哪次执行产生的，可选） |
| parent_id | string? | 父条目 ID（支持两级层级：任务→子步骤） |
| title | string | 步骤标题 |
| status | enum | `pending` / `doing` / `done` / `skipped` |
| order | int | 同层排序 |
| created_at | timestamp | |
| updated_at | timestamp | |

### 层级结构

```
ProgressItem (kind=task, parent_id=null)
  └─ ProgressItem (kind=step, parent_id=task.id)
  └─ ProgressItem (kind=step, parent_id=task.id)
ProgressItem (kind=task, parent_id=null)
  └─ ProgressItem (kind=step, parent_id=task.id)
```

两级结构：**任务（task）→ 步骤（step）**，对标 Claude.ai 的 Progress 面板样式。

---

## 三、写入机制

### AI 主动写入（核心路径）

AI 在执行任务时，通过 CLI 工具写入 ProgressItem：

```bash
# 创建任务（顶层）
pluse progress create --project-id proj_xxx --quest-id qst_xxx --title "分析需求文档"

# 创建子步骤
pluse progress create --project-id proj_xxx --quest-id qst_xxx \
  --parent-id progress_xxx --title "读取 requirements 目录"

# 更新状态
pluse progress update progress_xxx --status doing
pluse progress update progress_xxx --status done
```

这套操作会注入到 AI 的系统提示中，AI 在执行任务时主动调用。

### 写入时机规范（注入到 system prompt）

- 任务开始时：创建顶层 task 条目，状态 `pending`
- 拆解子步骤时：创建 step 条目，状态 `pending`
- 开始执行某步骤时：更新为 `doing`
- 完成某步骤时：更新为 `done`
- 所有步骤完成时：顶层 task 更新为 `done`

---

## 四、展示结构

Progress 面板在项目详情页或侧边栏展示，按 Quest 分组：

```
[ Quest: 开源协作空间调研 ]  · 今天
  ✓ 调研 Open Cowork 功能
    ✓ 下载安装包
    ✓ 分析源码结构
    ✓ 截图记录 UI
  ◌ 整理需求文档
    ✓ 写 requirements/0014
    ● 写 designs/0014  ← 当前正在做
    ○ 写 specs/0014

[ Quest: API 接入百炼 ]  · 昨天
  ✓ 配置 DashScope key
  ✓ 测试连通性
```

状态图标：`✓` done · `●` doing · `○` pending · `—` skipped

---

## 五、方案取舍

### 方案 A：复用 Todo 表，新增 source=progress 字段

**优点**：不新增表，利用现有 Todo 的增删改查基础设施  
**缺点**：Todo 是人工事项，Progress 是 AI 自动生成的过程记录，语义差异大；混入会导致 Todo 列表被污染；Todo 没有 run_id、parent_id 等 Progress 需要的字段

**结论：不采用**

### 方案 B：写入 run_spool（日志流）并前端解析

**优点**：零新表，日志天然实时  
**缺点**：run_spool 是非结构化文本流，不适合结构化查询和展示；前端解析脆弱；跨 Run 聚合困难

**结论：不采用**

### 方案 C：新建 progress_items 表（本设计采用）

**优点**：
- 语义清晰，独立于 Todo 和 Run
- 支持层级（parent_id）
- 支持跨 Run 持久
- 可独立查询、排序、过滤

**缺点**：新增表和 API

**结论：采用**

---

## 六、分期计划

### Phase 1（MVP）

- 新建 `progress_items` 表
- CLI 命令：`progress create / update / list`
- API：`GET /api/projects/:id/progress` — 项目维度聚合查询
- 前端：项目详情页展示 Progress 面板（只读）
- 注入 AI 系统提示，AI 在执行任务时自动写入

### Phase 2（后续）

- 实时推送（WebSocket / SSE）：执行中实时刷新
- Progress 面板独立侧边栏入口
- 按时间/Quest 过滤
- 归档旧 Progress 记录
