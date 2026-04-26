# 0006 — 会话列表一键复制 ID 实现 spec

**状态**: draft
**类型**: spec
**关联 requirement**: `docs/v2/requirements/0006-quick-select-and-copy-session-id.md`
**关联 design**: `docs/v2/designs/0006-quick-select-and-copy-session-id.md`

## 本期目标

在会话列表行内新增一个 `Copy ID` 动作按钮，使用户可在不离开列表的情况下复制当前会话 `id` 到剪贴板。

## 本期范围

1. 会话列表组件 UI 增加单按钮
   - 文件：`packages/web/src/views/components/SessionList.tsx`
   - 在 `SessionList` 列表条目右侧动作区新增 `copy id` 按钮。
   - 每条会话都可见（无需额外展开）。
   - 该按钮仅用于会话态 Quest 的列表行，不影响归档区域行为。

2. 复制行为接入系统剪贴板
   - 点击按钮后复制该行对应 `quest.id`。
   - 成功后给出短时提示（行内文字或 toast），例如“已复制”。
   - 失败时给出错误提示，且不中断会话列表操作。

3. i18n 与可访问性
   - 按钮包含可读文案/提示文本（至少 `aria-label`）以支持可访问性。
   - 使用现有 `useI18n().t` 机制对文案进行本地化调用。

4. 回退策略
   - 若环境不支持 `navigator.clipboard.writeText`，复制失败时显示错误提示。
   - 失败文案要清晰，避免静默失败。

## 影响模块

- `packages/web/src/views/components/SessionList.tsx`
- 视情况新增：`packages/web/src/i18n.tsx`（若需要集中维护文案）

## 数据与接口边界

本 spec 只改前端行为，不改：
- API/CLI/数据库
- 会话分类能力
- 消息发送链路

复制动作不应触发对 `Quest` 的任何状态更新。

## 交付标准

1. 会话列表里每条会话都显示 `Copy ID` 入口。
2. 点击后立即复制对应会话 `quest.id`。
3. 成功复制有可见反馈，失败有错误反馈。
4. 不影响会话导航、固定、归档、重命名等现有功能。
5. 行为在会话、归档列表中的按钮语义一致。
6. 前端变更不依赖新 API 或 schema。

## 不在范围内

- 批量复制
- 快捷键触发
- 在列表层新增“消息发送”新入口
- 与命令行参数格式相关的改造
