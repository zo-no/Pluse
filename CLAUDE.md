# Pluse 项目开发规范

## 功能开发工作流（必须遵守）

每个非琐碎功能或系统改造在实现前必须经过以下流程：

1. **讨论需求** — 先和用户确认真实问题、痛点、边界和成功标准
2. **写 Requirement** — 在 `docs/v2/requirements/` 下创建需求文档，先描述需求，不提前设计功能
3. **做 Design** — 在 `docs/v2/designs/` 下整理能力边界、系统结构和方案取舍
4. **写 Spec** — 在 `docs/v2/specs/` 下创建实现 spec，明确数据模型、接口、UI 和验收标准
5. **用户确认** — 等待用户确认 spec 后再开始编码
6. **按 spec 实现** — 严格按照 spec 实现，不擅自扩展范围

**规则：没有确认过的 spec 文件，不得开始编写非琐碎功能代码。**

## 功能优先级列表

- v1 存量功能优先级见 `docs/v1/ROADMAP.md`
- v2 新问题先进入 `docs/v2/requirements/`

## 版本说明

- `docs/mvp/architecture/` — 当前仍在使用的架构口径
- `docs/mvp/specs/` — 早期 MVP specs，归档参考
- `docs/v1/` — v1 迭代的 specs 和 roadmap（当前开发阶段）
- `docs/v2/` — v2 研发方法与新需求文档：先 requirement，再 design，再 spec

## 项目结构

- `packages/server` — Bun 后端，SQLite + HTTP API
- `packages/web` — React 前端，Vite + Tailwind
- `packages/types` — 共享类型定义

## 技术约定

- 包管理器：pnpm
- 运行时：Bun（server），Node（web build）
- 数据库：SQLite via bun:sqlite
- 前端状态：本地 useState，无全局状态管理
