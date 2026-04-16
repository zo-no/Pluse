# AGENTS.md — MelodySync v2 项目上下文

> 这是 AI 协作说明文件。开始任何工作前先读完这个文件。

---

## 这个项目是什么

MelodySync v2 是一个**远程 AI 会话工具**，核心职责：
1. 管理与 AI 的对话会话（Session / Run）
2. 提供会话执行与消息体验；需要编排任务时由 AI 在会话中直接调用 conductor CLI

**任务调度由 conductor 负责，本项目不实现任务系统，也不把 task/project 代理 API 作为长期边界。**

核心对象：
- **Session**（会话）— 持久对话容器，归属于某个 conductor Project
- **Run**（执行）— 某次会话执行的快照

---

## 如何读这个项目

### 第一步：读架构文档

```
docs/README.md         ← 文档导航入口
docs/architecture.md   ← 产品定位 + 系统边界（先读这个）
```

按需深入阅读：
- [数据模型](docs/data-model.md) — Session / Run 数据结构
- [执行模型](docs/execution-model.md) — Run 生命周期、会话内 conductor CLI、follow-up queue
- [数据库 Schema](docs/database-schema.md) — SQLite 表定义
- [架构实现](docs/implementation-guide.md) — 目录结构、迁移期兼容层、WebSocket
- [CLI & HTTP API](docs/cli-api.md) — 所有接口定义
- [Web UI 设计](docs/ui-design.md) — 布局、交互、组件
- [已决策项](docs/decisions.md) — 所有设计决策汇总
- [一期范围](docs/roadmap.md) — 当前开发目标

### 第二步：了解目录结构

```
melody-sync-v2/
├── packages/
│   ├── server/          # 后端（Bun + Hono + TypeScript）
│   │   └── src/
│   │       ├── db/           # SQLite 初始化
│   │       ├── middleware/   # HTTP 认证中间件
│   │       ├── models/       # Session / Run / Auth 数据操作层（含迁移期 project model）
│   │       ├── controllers/
│   │       │   ├── http/     # Hono 路由层
│   │       │   └── cli/      # Commander CLI 层
│   │       ├── server.ts     # HTTP server 入口（port 7761）
│   │       └── cli.ts        # CLI 入口（bin: melodysync）
│   │
│   ├── web/             # 前端（React 19 + Vite + Zustand + TailwindCSS）
│   └── types/           # 共享类型
│
└── docs/
```

### 第三步：理解 MVC 架构

```
Model（packages/server/src/models/）
  以 Session / Run 为主，直接操作 SQLite
  当前仍保留一层 project model 作为迁移期兼容

Controller — HTTP（packages/server/src/controllers/http/）
  Hono 路由，解析请求 → 调用 model → 返回响应
  当前仍有 projects 路由作为兼容层

Controller — CLI（packages/server/src/controllers/cli/）
  Commander 命令，直接调用 model

View（packages/web/src/）
  React 组件，通过 api/ 消费 HTTP API
```

## 迁移期注意

当前仓库仍保留一套本地 `Project` CRUD 和对应前端 controller（例如 `packages/server/src/models/project.ts`、`packages/server/src/controllers/http/projects.ts`、`packages/web/src/controllers/project.ts`）。这是早期实现沿下来的兼容层，不是 v2 的长期边界。

继续开发时，优先按 **Session / Run 主线** 理解系统；涉及任务编排时，默认假设 AI 在会话里直接调用 `conductor` CLI。

---

## 快速定位

| 要改什么 | 先看文档 | 再看代码 |
|---|---|---|
| 会话数据结构 | `docs/data-model.md` | `packages/server/src/models/session.ts` |
| Run 执行流程 | `docs/execution-model.md` | `packages/server/src/models/run.ts` |
| conductor 集成 | `docs/execution-model.md` | 无专门封装；按会话内 CLI 调用理解 |
| 迁移期 project 兼容层 | `docs/implementation-guide.md` | `packages/server/src/models/project.ts` / `packages/server/src/controllers/http/projects.ts` |
| WebSocket | `docs/implementation-guide.md` | 当前未落地，以 roadmap 为准 |
| CLI 命令 | `docs/cli-api.md` | `packages/server/src/controllers/cli/` |
| HTTP 路由 | `docs/cli-api.md` | `packages/server/src/controllers/http/` |
| 前端布局 | `docs/ui-design.md` | `packages/web/src/views/` |
| 已决策项 | `docs/decisions.md` | — |

---

## 开发规范

1. **Model 层无 HTTP 依赖**：model 函数只接受普通参数
2. **CLI 和 HTTP 共用 Model**：不在 controller 里写业务逻辑
3. **类型从 @melody-sync/types 引入**
4. **所有 CLI 命令支持 --json**
5. **SQLite 用 Bun 内置**
6. **任务操作走 conductor CLI**：不在 MelodySync 里直接操作任务数据库

---

## 操作任务的正确方式

AI 在会话中需要操作任务时，直接调用 conductor CLI：

```bash
# 查看任务
conductor task list --project <id> --json

# 创建任务
conductor task create --title "..." --project <id> --assignee ai --kind recurring --cron "0 9 * * *" --json

# 标记完成
conductor task done <id> --output "完成说明"
```

不要把 MelodySync 的 HTTP API 当成任务系统边界；任务编排默认都走 `conductor` CLI。

---

## 参考项目

- conductor：`/Users/kual/code/conductor`（任务调度引擎，本项目的依赖）
- v1：`/Users/kual/code/melody-sync`（可参考迁移实现）
