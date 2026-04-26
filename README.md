# Pluse

Pluse 是一个 **Quest-centric 的远程 AI 工作台**。

它把领域下的项目、项目内的 AI 会话、AI 任务、人类待办、运行记录和附件统一放进同一个工作域，而不是拆成互相松散的子系统。

## 当前模型

当前仓库已经切到统一的 Quest/Todo/Run 模型，核心对象如下：

- `Domain`: Project 的可选上层分组，只负责组织项目
- `Project`: 本地工作目录对应的项目容器
- `Quest`: 统一工作单元，`kind` 为 `session` 或 `task`
- `Run`: Quest 的一次执行
- `Todo`: 独立的人类待办，可选关联来源 Quest
- `QuestOp`: Quest 状态与形态变更日志
- `UploadedAsset`: Quest 级附件元数据

当前实现口径：

- `Domain` 只组织 `Project`，不承载 `Quest` / `Todo` / `Run`
- 默认入口项目是未分组下的 `自我对话`：首次使用会自动创建，回到首页时优先进入，用来承接用户尚未成形的需求、愿望、欲望和自我澄清会话
- `session` 和 `task` 不是两套主对象，而是同一个 `Quest` 的两种形态
- 详情页统一走 `/quests/:id`
- 左侧栏默认优先展示 `Domain` 项目分组；`会话` 视图只保留轻入口，不再重复渲染完整会话切换列表
- Todo 是独立对象，不挂在 Quest 子表下
- 不再维护旧的 `/api/sessions/*`、`/api/tasks/*` 边界

## 仓库结构

```text
packages/
├── server/   # Bun + Hono 服务端，HTTP / CLI / runtime / scheduler
├── web/      # React + Vite 前端
└── types/    # 共享类型

docs/
├── mvp/
│   └── architecture/
├── v1/
│   └── specs/
└── v2/
    ├── requirements/
    ├── designs/
    └── specs/
```

如果你要理解项目，建议先读这些文档：

- `docs/mvp/architecture/architecture.md`
- `docs/mvp/architecture/database-schema.md`
- `docs/mvp/architecture/ui-design.md`
- `docs/mvp/specs/core/0003-thread-unified-model.md`
- `docs/mvp/specs/core/0005-thread-execution-model.md`
- `docs/mvp/specs/features/0011-thread-centric-ia.md`
- `docs/v1/specs/0008-domain-project-grouping.md`
- `docs/v2/README.md`

## 开发环境

- `Node.js`: `18+`
- `pnpm`: `10.x`
- `Bun`: 用于服务端运行

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 首次构建

首次启动前建议先完整构建一次，避免后端启动时找不到前端产物。

```bash
pnpm build
```

如果你在访问 `http://localhost:7760` 时看到：

```text
Pluse frontend is not built yet. Run `pnpm build` in the workspace.
```

说明前端产物还没准备好，先执行上面的构建命令即可。

### 3. 配置登录凭据

Pluse 的业务 API 默认必须鉴权，不能在未登录状态下访问项目、会话、任务、Todo、运行记录或附件。首次使用前需要先在服务端本机配置登录凭据：

```bash
pnpm pluse auth setup --password "your-password"
```

可选配置用户名：

```bash
pnpm pluse auth setup --username "your-username" --password "your-password"
```

上面的命令需要在 Pluse 仓库根目录执行。如果已经安装了全局 `pluse` CLI，也可以直接执行：

```bash
pluse auth setup --password "your-password"
```

终端示例里的 `kualshown@... %` 是 shell 提示符，不要复制到命令里。

Web 端登录成功后，服务端会写入 `pulse_session` HttpOnly cookie 和 `pulse_csrf` cookie；后续浏览器请求必须带 cookie 才能访问 `/api/*` 业务接口。写操作还需要前端把 `pulse_csrf` 复制到 `X-CSRF-Token` 请求头。

API Token 登录用于 CLI / 自动化场景：

```bash
pnpm pluse auth token
```

生成的 token 可以通过登录页的 `API Token` 表单换取 cookie session，也可以作为 `Authorization: Bearer <token>` 直接访问 API。`/health` 和 `/api/auth/me` 是公开探测接口，其他业务 API 不做未配置鉴权放行。

### 4. 启动开发环境

```bash
pnpm dev
```

`pnpm dev` 会并行启动：

- `@pluse/web` 的构建监听
- `@pluse/server` 的开发服务

启动后可访问：

- Web: [http://localhost:7760](http://localhost:7760)
- API: [http://localhost:7760/api](http://localhost:7760/api)
- Health: [http://localhost:7760/health](http://localhost:7760/health)

## 常用命令

```bash
# 仅启动服务端
pnpm dev:server

# 仅启动前端构建监听
pnpm dev:web

# 构建所有包
pnpm build

# 类型检查
pnpm typecheck

# 服务端测试
pnpm test
```

## 数据与运行时

默认环境变量：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `PORT` | 服务端口 | `7760` |
| `PLUSE_ROOT` | 数据根目录 | `~/.pluse` |
| `PLUSE_DB_PATH` | SQLite 路径 | `~/.pluse/runtime/pluse.db` |
| `PLUSE_WEB_DIST` | 前端产物目录 | `packages/web/dist` |

Codex 运行时模型：

- 默认 Codex 模型为 `gpt-5.4`
- 后端会读取 `~/.codex/models_cache.json` 生成可选模型列表
- 模型缓存文件变化后，下一次请求 `/api/models?tool=codex` 会自动刷新 catalog，无需重启服务
- Codex 子进程运行在 Pluse 托管的 `CODEX_HOME` 下；执行前会从个人 Codex home 同步 `auth.json` 和 `models_cache.json`
- 如果某个 Codex 模型在当前账号下不可用，Run 会自动重试默认模型
- 当前内置 fallback 仍保留常用 Codex 模型，避免缓存缺失时模型选择为空

补充约束：

- SQLite 使用 `bun:sqlite`
- 附件统一按 `questId` 持久化到 `~/.pluse/assets/{questId}`
- CLI 与 HTTP 共享 Model / Service
- 类型统一从 `@pluse/types` 引入

## 运行时规则

- Session chat 忙时，新消息进入 `followUpQueue`
- Task manual run 冲突时返回 `409`
- Task automation run 忙时直接跳过
- 同一时刻一个 Quest 只允许一个 `activeRunId`
- `task -> session` 会保留 task 配置并暂停调度
- `session -> task` 会把 `status` 重置为 `pending`

## 现在不要按旧模型理解的点

- 不再以 `session.ts` / `task.ts` 作为长期主边界
- 不再把 Todo 当作 Quest 子对象
- 不再走 “Task 执行自动创建 Session” 这套模型

如果 README 和代码不一致，以 `docs/mvp/architecture/*`、`docs/mvp/specs/*`、`docs/v1/specs/*` 与 `docs/v2/*` 为准。
