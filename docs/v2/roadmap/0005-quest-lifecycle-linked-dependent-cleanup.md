# 0005 — Quest Lifecycle-Linked Dependent Cleanup Roadmap

## 目标

建立一套清晰的生命周期归属规则，让 Quest 在退出当前工作面时，能够正确收敛由它派生的低价值 attention signal，同时保留独立 Todo 和历史记录。

## 当前状态

`spec`

## 当前焦点

review `Phase 1 quest archive review todo pruning spec`，确认最小实现边界是“Quest archive 驱动的 system review Todo 剪枝”，而不是通用 cleanup engine。

## 已完成产物

- `docs/v2/requirements/0005-quest-lifecycle-linked-dependent-cleanup.md`
- `docs/v2/designs/0005-quest-lifecycle-linked-dependent-cleanup.md`
- `docs/v2/specs/0005-quest-archive-review-todo-pruning-phase-1.md`

## 当前阻塞

- 等待确认是否接受“Quest restore 不自动恢复被剪枝 review Todo”的非对称语义
