# AGENTS.md — Pluse 项目上下文

> 这是 AI 协作说明文件。开始任何工作前先读完这个文件。

---

## 这个项目是什么

Pluse 是一个 **Quest-centric 的远程 AI 工作台**。

核心职责：
1. 管理 Project 下的 Session / Task 两类 Quest
2. 执行 Quest Run（chat / manual / automation）
3. 管理独立 Todo
4. 持久化 Quest 附件、运行历史、活动日志

**当前仓库按 big-bang Quest/Todo/Run 模型实现：不做向前兼容，不保留旧 `sessions/tasks/task_runs/task_ops` 作为长期边界。**

核心对象：
- **Project**：项目容器，对应本地工作目录
- **Quest**：统一工作容器；`kind='session'` 或 `kind='task'`
- **Run**：Quest 的一次执行
- **Todo**：独立人工待办，可选记录来源 Quest
- **QuestOp**：Quest 状态 / kind 变更日志
- **UploadedAsset**：Quest 级附件元数据

---

## 如何读这个项目

### 第一步：读当前架构文档

优先阅读：

```text
docs/architecture/architecture.md
docs/architecture/database-schema.md
docs/architecture/ui-design.md
docs/specs/core/0003-thread-unified-model.md
docs/specs/core/0005-thread-execution-model.md
docs/specs/features/0011-thread-centric-ia.md
```

按需深入：
- `docs/architecture/data-model.md`
- `docs/architecture/execution-model.md`
- `docs/specs/features/0007-file-attachments.md`
- `docs/specs/features/0009-session-search.md`
- `docs/specs/features/0005-project-delete.md`
- `docs/specs/infra/0001-sse-realtime.md`

### 第二步：看目录结构

```text
pluse/
├── packages/
│   ├── server/
│   │   └── src/
│   │       ├── db/
│   │       ├── middleware/
│   │       ├── models/        # Project / Quest / Todo / Run / Auth
│   │       ├── controllers/
│   │       │   ├── http/
│   │       │   └── cli/
│   │       ├── runtime/       # Quest run 执行与 provider 进程管理
│   │       ├── services/      # effects / scheduler / projects / prompts
│   │       ├── server.ts
│   │       └── cli.ts
│   ├── web/
│   └── types/
└── docs/
```

### 第三步：理解主线

```text
Project
  ├── Quest(kind='session')
  ├── Quest(kind='task')
  ├── Todo
  └── Run / QuestOp / UploadedAsset
```

- Session 与 Task 不是两套主对象，而是 Quest 的两种形态。
- 所有详情页统一使用 `/quests/:id`。
- Todo 是独立对象，不挂在 Quest 子表里。

---

## 快速定位

| 要改什么 | 先看文档 | 再看代码 |
|---|---|---|
| Quest 数据结构 | `docs/architecture/data-model.md` | `packages/server/src/models/quest.ts` |
| Run 执行流程 | `docs/architecture/execution-model.md` | `packages/server/src/runtime/session-runner.ts` / `packages/server/src/models/run.ts` |
| 调度逻辑 | `docs/specs/core/0005-thread-execution-model.md` | `packages/server/src/services/scheduler.ts` |
| Todo | `docs/architecture/architecture.md` | `packages/server/src/models/todo.ts` / `packages/server/src/services/todos.ts` |
| 附件 | `docs/specs/features/0007-file-attachments.md` | `packages/server/src/controllers/http/assets.ts` / `packages/server/src/models/asset.ts` |
| HTTP 路由 | `docs/architecture/architecture.md` | `packages/server/src/controllers/http/` |
| CLI 命令 | `docs/architecture/architecture.md` | `packages/server/src/controllers/cli/` |
| 前端信息架构 | `docs/architecture/ui-design.md` | `packages/web/src/views/` |
| 实时更新 | `docs/specs/infra/0001-sse-realtime.md` | `packages/server/src/controllers/http/events.ts` |

---

## 当前实现约束

1. **Model 层不依赖 HTTP**
2. **CLI / HTTP 共享 Model 与 Service**
3. **类型统一从 `@pluse/types` 引入**
4. **所有 CLI 命令支持 `--json`**
5. **SQLite 使用 Bun 内置 `bun:sqlite`**
6. **不新增旧 Session/Task 兼容接口**
7. **附件一律按 `questId` 持久化到 `~/.pluse/assets/{questId}`**

---

## Quest 运行时规则

- Session chat 忙时，新消息进入 `followUpQueue`
- Task manual run 冲突返回 `409`
- Task automation run 忙时直接 skip
- Quest `kind` 可切换，但同一时刻只有一个 `activeRunId`
- `task -> session` 保留 task 配置并暂停调度
- `session -> task` 时 `status` 重置为 `pending`

---

## 不要再按旧口径理解的内容

- 不再使用 `packages/server/src/models/session.ts`
- 不再使用 `packages/server/src/models/task.ts`
- 不再实现 `/api/sessions/*` 或 `/api/tasks/*`
- 不再把 Todo 当作 Quest 子对象
- 不再使用 “Task 执行自动创建 Session” 这套模型

---

## 参考项目

- 历史仓库：仅用于迁移思路参考
