# 0010 — CLI Agent 上下文增强

**状态**: draft  
**优先级**: high  
**估算**: S

## 背景

Agent 启动时需要快速定位"应该在哪个项目里工作"。当前 CLI 缺少两个关键能力：

1. `domain list` 只输出 Domain 基础信息，看不到下面有哪些项目、项目目标是什么
2. Project 只有一句话的 `goal` 字段，缺少供 Agent 读取的详细项目介绍

Agent 的理想定位流程：
```
pluse domain list --with-projects   → 看全局结构，找到目标 domain/project
pluse project overview <id>         → 看项目详情和近期活动
pluse quest create ...              → 开始工作
```

目前 step 1 缺失，step 2/3 已有。

## 目标

- `domain list` 支持 `--with-projects` 选项，输出 Domain + 下属 Project 的树形结构（含项目介绍）
- Project 新增 `description` 字段，存放比 `goal` 更详细的项目介绍，供 Agent 读取定位

## 不在范围内

- UI 层展示 `description` 字段（可后续迭代）
- AI 自动生成项目介绍
- Domain 级别的 Agent 入口或自动分配

## 方案设计

### 1. Project 新增 `description` 字段

**数据库：**
```sql
ALTER TABLE projects ADD COLUMN description TEXT;
```

**类型定义（`@pluse/types`）：**
```ts
interface Project {
  // existing fields...
  description?: string
}
```

**API：**
- `GET /api/projects` 和 `GET /api/projects/:id` 响应体包含 `description`
- `PATCH /api/projects/:id` 支持更新 `description`
- `POST /api/projects/open` 支持传入 `description`

**CLI：**
```bash
pluse project open --work-dir ~/xxx --description "这是一个..."
pluse project update <id> --description "更新介绍"
```

`printProject` 输出里增加 description 行：
```
proj_abc  Pluse
  workDir: ~/Desktop/Pluse
  goal: Agent 工作台
  description: Pluse 是一个 AI Agent 工作台，用于管理多个 AI 会话和任务...
```

### 2. `domain list --with-projects`

**输出格式（默认文本）：**
```
domain_xxx  产品/事业
  description: 产品研发相关项目
  projects:
    proj_abc  Pluse
      workDir: ~/Desktop/Pluse
      goal: Agent 工作台
      description: Pluse 是一个 AI Agent 工作台...
    proj_def  另一个项目
      workDir: ~/Desktop/other
      goal: ...

domain_yyy  财富
  projects: (空)

(未分组)
  projects:
    proj_ghi  work_health
      workDir: ~/.pluse/work_health
      goal: 健康管理
```

**输出格式（`--json`）：**
```json
[
  {
    "id": "domain_xxx",
    "name": "产品/事业",
    "description": "...",
    "projects": [
      { "id": "proj_abc", "name": "Pluse", "workDir": "...", "goal": "...", "description": "..." }
    ]
  },
  {
    "id": null,
    "name": "未分组",
    "projects": [...]
  }
]
```

**实现：**

在 `domain.ts` CLI controller 里，`list` 命令新增 `--with-projects` 选项。
有 daemon 时通过新增 API endpoint `GET /api/domains?withProjects=true` 获取；
无 daemon 时直接调用 `listDomains()` + `listVisibleProjects()` 在本地组合。

### 3. Agent 使用示例（CLAUDE.md 或系统 Prompt 参考）

```bash
# 查看所有领域和项目（Agent 启动时定位用）
pluse domain list --with-projects --json

# 查看某个项目的详情和近期活动
pluse project overview <project-id> --json

# 在确定的项目里新建会话
pluse quest create --project-id <id> --kind session --name "任务名称"
```

## 验收标准

- [ ] `projects` 表新增 `description` 字段，迁移脚本正确执行
- [ ] `Project` 类型定义包含 `description?: string`
- [ ] `project open` CLI 支持 `--description` 选项
- [ ] `project update` CLI 支持 `--description` 选项
- [ ] `printProject` 输出包含 description（非空时）
- [ ] `domain list --with-projects` 输出 Domain + 下属 Project 树形结构
- [ ] `domain list --with-projects --json` 输出结构化 JSON，含未分组
- [ ] 未分组项目在 `--with-projects` 输出里单独成组显示

## 验收标准补充

- [ ] `@pluse/types` 的 `Project`、`OpenProjectInput`、`UpdateProjectInput` 类型均包含 `description?: string`
- [ ] `AGENTS.md` 新增"Agent 定位项目"章节，包含 `domain list --with-projects --json` → `project overview` 的标准流程

## 备注

- `description` 和 `goal` 的区别：`goal` 是一句话目标（已有），`description` 是给 Agent 读的详细介绍，可以多段，说明项目背景、技术栈、当前阶段等
- `domain list --with-projects` 的数据可以复用 `listVisibleProjects()` + 按 `domainId` 分组，不需要新的复杂查询
- `AGENTS.md` 里补充的 Agent 定位流程示例：
  ```bash
  # 1. 看全局结构，找目标项目
  pluse domain list --with-projects --json
  # 2. 看项目详情和近期活动
  pluse project overview <id> --json
  # 3. 开始工作
  pluse quest create --project-id <id> --kind session --name "任务名"
  ```
- 后续可在各项目的 `CLAUDE.md` 里写项目专属的 Agent 工作规范，`description` 字段作为全局摘要
