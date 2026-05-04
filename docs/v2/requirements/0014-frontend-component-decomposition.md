# 0014 — 前端核心组件去巨型化

**状态**: draft
**类型**: requirement (technical-debt)
**优先级**: medium

## 背景

Pluse 前端在 v1 / v2 多个需求叠加后，部分核心文件已经显著超出可舒适阅读和定位的尺度：

- `packages/web/src/views/components/TodoPanel.tsx` — 2226 行
- `packages/web/src/views/pages/MainPage.tsx` — 1972 行
- `packages/web/src/views/components/TaskDetail.tsx` — 1238 行
- `packages/web/src/views/components/ChatView.tsx` — 1238 行
- `packages/web/src/views/components/TaskComposerModal.tsx` — 974 行
- `packages/web/src/views/components/SessionList.tsx` — 898 行

其中 `TodoPanel.tsx` 单组件中有 35 个 `useState`、9 个 `useEffect`、20 个 `useMemo`、19 个 `useCallback`，已经塞入大量手动性能优化手段；`MainPage.tsx` 把 12 个组件（包含应用壳 `Shell`）合写在一个文件里。

这些文件都不是一次写出来的，而是随着 v1 / v2 需求迭代逐步堆叠形成的。

## 真实问题

**文件复杂度已经开始反向影响后续需求的实现节奏：**

1. 任意小改动都需要在 1500–2200 行里翻找位置，定位时间显著高于编辑时间
2. 单组件状态过多时，新增功能需要谨慎评估是否会重渲染整个组件树或与其他子域状态相互污染
3. 测试边界模糊 —— 子域之间没有显式接口，只能整体测试
4. Code review 难以聚焦 —— diff 散落在长文件多处，评审者难判断变更影响范围
5. 已经引入的 `memo` / `useCallback` / `useMemo` 是「为巨型组件抢救渲染开销」的补丁，而不是结构性解法

注意：**当前没有用户报告的运行时性能问题。** 这条需求要解决的是工程可维护性，不是性能。

## 顶层目标

让 web 前端关键文件维持在可阅读、可定位、可独立修改的尺度，使后续业务需求（Todo / Reminder / Check-in / Project / Automation 等）能在不需要先理解 2000 行上下文的前提下进行迭代。

## 成功状态

- 单文件不再承担多个无关业务子域的状态与渲染
- 单文件 / 单组件复杂度（行数、useState 密度）可作为可量化指标，并显著低于当前水平
- 新加一项 Todo / Reminder / Check-in / Project 相关的小功能时，触及的代码定位时间 < 5 分钟
- 当前已引入的手动性能优化手段（`memo` / `useCallback` / `useMemo`）能在结构改善后被简化或移除，而不是继续叠加
- 前端约定与代码现实保持一致：`CLAUDE.md` 中「无全局状态管理」继续成立，未引入新的状态管理库
- 用户可见行为（UI、交互、路由）在去巨型化前后保持一致

## 不在范围内

- 前端运行时性能优化（无现场，待真实卡顿报告再单独立项）
- 引入 zustand 或其他状态管理库（已验证当前痛点与全局状态无关）
- 后端代码结构重构（如 `runtime/session-runner.ts` 1530 行） —— 如要做应单独立项
- 视觉 / 交互 / IA 改动（这条需求只动文件结构，不动用户可见行为）
- 单元测试体系建立 / 覆盖率目标（独立工程议题）
- 删除 `packages/web/package.json` 中未使用的 `zustand` 依赖（琐碎清理，不走流程）

## 候选范围（由 design 阶段决定优先级与边界）

- `TodoPanel.tsx` 子域拆分
- `MainPage.tsx` 多组件分文件
- 其他超过 ~800 行的组件文件（`TaskDetail.tsx` / `ChatView.tsx` / `TaskComposerModal.tsx` / `SessionList.tsx`）

design 阶段需要进一步评估：哪些是真问题、哪些只是行数虚高（如内含大量纯函数或常量表）、拆分边界是否自然，以及是否需要分期。
