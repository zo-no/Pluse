# 架构概览

## 产品定位

MelodySync v2 是一个**本地 AI 会话工具**。

核心概念：
- **Project（项目）**：映射到本地文件系统的一个文件夹，是会话的容器
- **Session（会话）**：Project 下的一个持久对话，对应一段与 AI 的完整交流历史
- **Run（执行）**：Session 内一次消息的具体执行过程

## 系统边界

```
MelodySync v2
  ├── Project 管理（本地文件夹映射 + system prompt 配置）
  ├── Session 管理（CRUD、历史、置顶、归档）
  ├── Run 执行（fork Claude CLI 子进程 + spool 文件通信）
  ├── Auth（password / token / cookie）
  ├── WebSocket（实时推送：invalidation hint + run delta）
  └── Web UI
      ├── 项目列表 / 切换
      ├── 会话列表
      └── 聊天视图（历史 + 输入框）
```

## 技术栈

| 层 | 技术 |
|---|---|
| Runtime | Bun |
| HTTP Server | Hono |
| Database | SQLite（bun:sqlite，WAL 模式） |
| Frontend | React + Zustand + Tailwind CSS |
| AI Provider | Claude CLI（fork 子进程） |
| 包管理 | Bun workspaces（monorepo） |

## 包结构

```
packages/
  types/     — 共享 TypeScript 类型（Session、Run、Project、API 响应）
  server/    — Bun HTTP server（Hono）+ CLI（Commander）
  web/       — React 前端
```

## 数据流

```
用户在 Web UI 输入消息
  → POST /api/sessions/:id/messages
  → server 创建 Run（state='accepted'）
  → server fork Claude CLI 子进程（工作目录 = project.path）
  → 子进程流式输出写入 spool.jsonl
  → server 读取 spool，通过 WebSocket 推送 delta 给前端
  → 执行完成，server 将 spool 内容归一化写入 session_events
  → Run state='completed'，WebSocket 推送 invalidation
  → 前端重新拉取 session events，刷新聊天视图
```

## 存储布局

```
~/.melodysync/
  runtime/
    sessions.db          — SQLite 主数据库
    history/
      <sessionId>/
        events/          — 事件文件（每条一个 JSON 文件）
        bodies/          — 大 body 外部化存储
    runs/
      <runId>/
        status.json      — Run 生命周期状态
        manifest.json    — 执行参数快照
        spool.jsonl      — Claude CLI 原始输出（append-only）
    file-assets/         — 用户上传的文件
```
