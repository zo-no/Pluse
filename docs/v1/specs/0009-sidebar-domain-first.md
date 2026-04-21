# 0009 — 侧边栏 Domain 优先重构

**状态**: draft  
**优先级**: high  
**估算**: M

## 背景

当前侧边栏顶部有两个冗余区域：
1. "Project" 下拉切换器（选择当前项目）
2. 项目名称/路径 + 设置图标（显示当前项目信息）

这两块加上 Domain/Session tabs 叠在一起，层级混乱。既然 Domain tab 已经承担了所有项目导航（列表展示 + 点击切换），顶部这两块就没有存在的必要了。

同时，上一次重构（0429a8f）把 Session tab 的会话列表简化成了一张说明卡片，导致体验退步——用户无法在侧边栏直接看到/切换会话。

## 目标

- 移除顶部冗余的 Project 切换器区域
- Domain tab 承担所有项目导航，包含新建项目入口
- Session tab 恢复完整的会话列表体验

## 不在范围内

- 项目设置页面（`/projects/:id`）不变
- Domain 数据模型不变
- 后端 API 不变

## 方案设计

### 移除的区域

`SessionList.tsx` 中删除：
- `pluse-sidebar-section-context`：整块（"项目"标签 + 项目下拉选择器 + 新建项目表单）
- `pluse-sidebar-section-project`：整块（项目名称/路径 + 设置图标 + Domain/Session tabs）

Domain/Session tabs 上移到侧边栏 `pluse-sidebar-body` 的顶部，直接作为一级导航。

### Domain tab 变化

**新增"新建项目"入口：**

在 `DomainSidebar.tsx` 的工具栏（`pluse-domain-toolbar`）里，现有"新建领域"和"使用默认模板"旁边，加一个"+ 新建项目"按钮。

点击后弹出 Modal（复用现有 `pluse-modal-panel` 样式），表单字段：
- 项目名称（可选，placeholder：工作目录的最后一段）
- 工作目录（必填）
- 项目目标（可选，textarea）
- 所属领域（select，默认"未分组"）

提交后：关闭 Modal → 刷新项目列表 → 导航到新项目 `/projects/:id`。

**项目管理面板入口：**

Domain 列表里每个 Project 行，hover 时右侧显示设置图标（`SlidersIcon`），点击跳到 `/projects/:id`。平时隐藏，保持列表干净。风格与 Domain 分组 hover 操作一致。

**当前活跃项目高亮：**

已有 `is-active` class，无需额外改动。Domain 列表里点击某个 Project 行即切换当前项目，高亮跟随。

### Session tab 变化

恢复完整会话列表，具体包括：

1. **搜索框**：`pluse-sidebar-search`，输入过滤会话名称
2. **固定/最近分组**：有固定会话时显示"固定"标签，其余归入"最近"
3. **会话列表**：每行显示会话名称、状态、时间，点击切换
4. **归档折叠区**：底部可展开归档会话，按日期分组
5. **新建会话按钮**：底部固定"+ 新建会话"

切换项目后，Session tab 自动刷新为新项目的会话列表。若当前项目有会话，默认展示列表（不自动跳转到第一个会话，用户手动选择）。

### tabs 位置调整

移除顶部两个 section 后，tabs 直接放在 `pluse-sidebar-body` 顶部：

```
pluse-sidebar-body
  ├── pluse-sidebar-tabs  ← Domain | Session（顶部一级导航）
  ├── [Domain tab 内容] 或 [Session tab 内容]
  └── [错误提示]
```

## UI 草图

```
┌─────────────────────────────┐
│  未分组              ← 小字  │
│  Pluse               ← 大字  │  ← tabs 上方，当前项目上下文
├─────────────────────────────┤
│  Domain    Session          │  ← tabs
├─────────────────────────────┤
│  全部项目  6 个项目          │
│  [+ 新建项目] [+ 新建领域]   │
│  [使用默认模板]              │
├─────────────────────────────┤
│  ▸ 未分组  6 个项目          │
│    • Pluse  ●           ⚙️  │  ← 当前项目高亮，hover 显示 ⚙️
│    • work_health        ⚙️  │  ← hover 显示
│  ▸ 产品/事业  0 个项目       │
│  ...                        │
└─────────────────────────────┘
```

```
┌─────────────────────────────┐
│  Domain    Session          │  ← tabs 顶部
├─────────────────────────────┤
│  🔍 搜索                    │
├─────────────────────────────┤
│  固定                       │
│  • 会话 A                   │
│  最近                       │
│  • 会话 B           ●运行中 │
│  • 会话 C                   │
│  ▸ 归档 (3)                 │
├─────────────────────────────┤
│  [+ 新建会话]               │
└─────────────────────────────┘
```

## 验收标准

- [ ] 侧边栏顶部不再有 Project 下拉切换器
- [ ] 侧边栏顶部不再有项目名称/路径/设置图标区域
- [ ] tabs 上方显示两行：小字领域名（无领域显示"未分组"）+ 大字项目名
- [ ] Domain/Session tabs 位于项目上下文下方
- [ ] Domain tab 工具栏有"+ 新建项目"按钮，与其他两个按钮 UI 一致
- [ ] 点击"+ 新建项目"弹出 Modal，含名称/目录/目标/领域字段
- [ ] 新建项目后导航到新项目概览页
- [ ] Domain 列表里点击项目：高亮该项目 + 导航到 `/projects/:id` + tabs 上方更新为该项目名/领域名
- [ ] Domain 列表里 hover 项目行时显示 ⚙️，点击跳到 `/projects/:id`
- [ ] tabs 上方领域名/项目名随项目切换实时更新
- [ ] Session tab 显示完整会话列表（搜索 + 固定/最近 + 归档 + 重命名双击）
- [ ] Session tab 底部有"+ 新建会话"按钮
- [ ] 切换项目后 Session tab 刷新为该项目的会话列表
- [ ] 移动端：点击项目行 / ⚙️ 后侧边栏自动关闭
- [ ] 旧的 `.pluse-project-switcher` 等 CSS 类已从 index.css 中清理

## 设计决策（已确认）

1. **"+ 新建项目"按钮位置**：放在 Domain tab 工具栏，与"新建领域"和"使用默认模板"保持 UI 一致性，三个按钮同级并排。

2. **切换项目后行为**：点击 Domain 列表里的项目行，高亮该项目 **并** 导航到 `/projects/:id`（项目概览页）。Session tab 的会话列表同步刷新为该项目的会话。

3. **tabs 上方的上下文**：tabs 上方保留两行——小字显示当前所属领域名（无领域时显示"未分组"），大字显示当前项目名。

## 备注

### 组件层

- `handleCreateProject` 逻辑从原 `pluse-sidebar-section-context` 搬到新 Modal 组件（在 `SessionList.tsx` 内 inline 实现，不单独抽文件）
- Session tab 的会话列表逻辑（`renderQuest`、`handleRename`、`handlePin`、`handleArchive`、搜索、归档分组）从 commit `b1dcf73` 之前的代码里完整恢复
- 移除的状态：`projectPickerOpen`、`newProjectOpen`、`pickerRef`（原属于下拉切换器）
- 保留的状态：`renamingId`、`renameValue`、`archivedSessions`、`archivedSessionsExpanded`、`searchQuery`（Session tab 需要）
- `useI18n()` 解构需补上 `locale`（当前只有 `t`，归档日期格式化需要 `locale`）
- Session tab 恢复需要从 `b1dcf73` 前的代码搬回的函数：`formatSidebarTime`、`formatSidebarAbsoluteTime`、`formatArchiveDateLabel`、`getSessionPresenceState`，以及 import `displayQuestName`、`ClockIcon`、`PinIcon`、`ArchiveIcon`
- `sidebarTab` 默认值保持 `'domains'`（当前已是，不要改回 `'sessions'`）
- `pluse-domain-toolbar` 已有 `flex-wrap: wrap`，三个按钮并排空间不够时会自动换行，无需额外处理
- tabs 上方领域名解析：`domains.find(d => d.id === activeProject?.domainId)?.name ?? t('未分组')`，`domains` 已在 `SessionList` 状态里，通过 `activeProject` prop 传给 `DomainSidebar` 即可在组件内解析，不需要额外 API 调用

### DomainSidebar props 变更

新增：
- `onCreateProject: () => void`：触发新建项目 Modal（Modal 本身在 `SessionList` 层管理）
- `activeProject: Project | null`：用于 tabs 上方显示当前项目名

tabs 上方的领域名通过 `domains.find(d => d.id === activeProject?.domainId)?.name` 解析，无需额外 prop。

### renderProject 改造

`DomainSidebar.tsx` 的 `renderProject` 从纯 `<button>` 改为带 hover 操作区的行，结构参考现有 `pluse-sidebar-item` + `pluse-sidebar-item-actions` 模式：

```jsx
<div className="pluse-sidebar-item pluse-sidebar-row pluse-domain-project-item ...">
  <button className="pluse-sidebar-item-main" onClick={...}>  {/* 切换项目 */}
    ...
  </button>
  <div className="pluse-sidebar-item-actions">
    <button className="pluse-sidebar-more-btn" onClick={...}>  {/* ⚙️ 跳到设置 */}
      <SlidersIcon />
    </button>
  </div>
</div>
```

⚙️ 按钮默认 `opacity: 0`，hover 行时显示（复用现有 `.pluse-sidebar-item:hover .pluse-sidebar-more-btn { opacity: 1 }` 机制，无需新增 CSS）。

- 左侧点击：`onSelectProject(project.id)` + `navigate('/projects/:id')` + `onNavigate?.()`
- ⚙️ 点击：`navigate('/projects/:id')` + `onNavigate?.()`（同一目标，语义是进入设置）

### CSS 层

- 可删除：`.pluse-sidebar-section-context`、`.pluse-project-switcher`、`.pluse-project-switcher-btn`、`.pluse-project-switcher-label`、`.pluse-project-switcher-chevron`、`.pluse-sidebar-section-project`、`.pluse-sidebar-project-header`、`.pluse-project-picker`、`.pluse-project-picker-list`、`.pluse-project-picker-item`、`.pluse-project-picker-footer`、`.pluse-project-picker-add`、`.pluse-session-entry-card` 相关样式
- 新增：`.pluse-sidebar-project-context`（tabs 上方两行：领域小字 + 项目大字）

### i18n

- 新增 `新建项目` key（不复用 `添加项目`，语义不同）
- 新增 `项目设置`（⚙️ 按钮 `aria-label` 和 `title`）
- 现有 `打开项目面板` key 可删除（原属于被移除的设置按钮）

### SSE 自动刷新

新建项目后服务端会 emit `project_opened` 事件，`Shell` 层的 SSE 监听会自动调用 `loadProjects()`，侧边栏项目列表无需手动刷新，只需关闭 Modal 并导航。

### Modal 实现

新建项目 Modal 复用现有 `.pluse-modal-backdrop` + `.pluse-modal-panel` 样式，在 `SessionList.tsx` 内管理状态（`newProjectModalOpen`），通过 `onCreateProject` prop 传给 `DomainSidebar` 触发开关。
