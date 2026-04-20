# Pluse 项目开发规范

## 功能开发工作流（必须遵守）

每个功能在实现前必须经过以下流程：

1. **讨论** — 与用户讨论功能方案，达成一致
2. **写 Spec** — 在 `docs/v1/specs/` 下创建 spec 文档，文件名格式：`NNNN-feature-name.md`
3. **用户确认** — 等待用户确认 spec 后再开始编码
4. **按 spec 实现** — 严格按照 spec 实现，不擅自扩展范围

**规则：没有 spec 文件，不得开始编写功能代码。**

Spec 文件模板见 `docs/v1/0000-template.md`。

## 功能优先级列表

见 `docs/v1/ROADMAP.md`。

## 版本说明

- `docs/mvp/architecture/` — 当前仍在使用的架构口径
- `docs/mvp/specs/` — 早期 MVP specs，归档参考
- `docs/v1/` — v1 迭代的 specs 和 roadmap（当前开发阶段）

## 项目结构

- `packages/server` — Bun 后端，SQLite + HTTP API
- `packages/web` — React 前端，Vite + Tailwind
- `packages/types` — 共享类型定义

## 技术约定

- 包管理器：pnpm
- 运行时：Bun（server），Node（web build）
- 数据库：SQLite via bun:sqlite
- 前端状态：本地 useState，无全局状态管理
