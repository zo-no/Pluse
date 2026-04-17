# Pulse Workspace

一个统一的工作空间管理工具。

## 开发环境

- **Node.js**: v18+
- **包管理器**: pnpm 10.x
- **运行时**: Bun (后端)

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 构建前端

**重要**: 必须先构建前端，否则访问 http://localhost:7760 时会看到以下错误：

```
Pulse frontend is not built yet. Run `pnpm build` in the workspace.
```

构建命令：

```bash
# 构建所有包（推荐首次使用）
pnpm build

# 或只构建前端
pnpm --filter @melody-sync/web build
```

### 3. 启动开发服务器

```bash
pnpm dev
```

服务启动后：
- **Web 界面**: http://localhost:7760
- **API 端点**: http://localhost:7760/api
- **健康检查**: http://localhost:7760/health

## 常用命令

```bash
# 仅启动后端
pnpm dev:server

# 仅启动前端构建监听
pnpm dev:web

# 类型检查
pnpm typecheck

# 运行测试
pnpm test
```

## 项目结构

```
packages/
├── web/        # React + Vite 前端
├── server/     # Bun + Hono 后端 API
└── types/      # 共享类型定义
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务器端口 | 7760 |
| `PULSE_ROOT` | 数据存储目录 | ~/.pulse |
| `PULSE_DB_PATH` | SQLite 数据库路径 | ~/.pulse/db.sqlite |
| `PULSE_WEB_DIST` | 前端构建目录 | packages/web/dist |
