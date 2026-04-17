# AGENTS.md — Pluse v2 项目上下文

> 这是 AI 协作说明文件。开始任何工作前先读完这个文件。

---

## 这个项目是什么

Pluse v2 是一个**远程 AI 会话工具**，核心职责：
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
docs/architecture/README.md         ← 文档导航入口
docs/architecture/architecture.md   ← 产品定位 + 系统边界（先读这个）
```

按需深入阅读：
- [数据模型](docs/architecture/data-model.md) — Session / Run 数据结构
- [执行模型](docs/architecture/execution-model.md) — Run 生命周期、会话内 conductor CLI、follow-up queue
- [数据库 Schema](docs/architecture/database-schema.md) — SQLite 表定义
- [CLI & HTTP API](docs/architecture/api.md) — 所有接口定义
- [Web UI 设计](docs/architecture/ui-design.md) — 布局、交互、组件
- [Conductor 集成](docs/architecture/conductor-integration.md) — 会话内 CLI 调用边界
- [UI 线框图](docs/architecture/wireframes.md) — 页面布局与结构草图
- [当前 Roadmap](docs/specs/ROADMAP.md) — 当前功能进展与优先级

### 第二步：了解目录结构

```
pluse-v2/
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
│   │       └── cli.ts        # CLI 入口（bin: pluse）
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
| 会话数据结构 | `docs/architecture/data-model.md` | `packages/server/src/models/session.ts` |
| Run 执行流程 | `docs/architecture/execution-model.md` | `packages/server/src/models/run.ts` |
| conductor 集成 | `docs/architecture/conductor-integration.md` | 无专门封装；按会话内 CLI 调用理解 |
| 迁移期 project 兼容层 | `docs/architecture/architecture.md` | `packages/server/src/models/project.ts` / `packages/server/src/controllers/http/projects.ts` |
| WebSocket / SSE | `docs/specs/infra/0001-sse-realtime.md` | 以当前实现与 spec 为准 |
| CLI 命令 | `docs/architecture/api.md` | `packages/server/src/controllers/cli/` |
| HTTP 路由 | `docs/architecture/api.md` | `packages/server/src/controllers/http/` |
| 前端布局 | `docs/architecture/ui-design.md` | `packages/web/src/views/` |
| 当前功能范围 | `docs/specs/ROADMAP.md` | `docs/specs/core/` / `docs/specs/features/` / `docs/specs/infra/` |

---

## 开发规范

1. **Model 层无 HTTP 依赖**：model 函数只接受普通参数
2. **CLI 和 HTTP 共用 Model**：不在 controller 里写业务逻辑
3. **类型从 @pluse/types 引入**
4. **所有 CLI 命令支持 --json**
5. **SQLite 用 Bun 内置**
6. **任务操作走 conductor CLI**：不在 Pluse 里直接操作任务数据库

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

不要把 Pluse 的 HTTP API 当成任务系统边界；任务编排默认都走 `conductor` CLI。

---

## 参考项目

- conductor：`/Users/kual/code/conductor`（任务调度引擎，本项目的依赖）
- v1：历史仓库（可参考迁移实现）
