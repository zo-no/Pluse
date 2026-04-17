# 0010 — Task Rail 卡片样式优化

**状态**: approved  
**优先级**: medium  
**估算**: S

## 背景

任务详情已改为弹窗（modal）形式，任务列表卡片本身的设计需要同步优化，以更好地匹配"点击打开弹窗"的交互模式。当前卡片样式问题：

1. 卡片视觉层次弱 — 标题/状态/元信息权重平均，重点不突出
2. 交互反馈不足 — 卡片可点击但无 hover 高亮，用户不知道点击会打开弹窗
3. 元信息过于拥挤 — 状态/AI/周期三个 tag 堆在一行，视觉杂乱
4. 无卡片感 — 当前是分割线列表，缺少独立卡片的视觉重量

## 目标

- 每个任务呈现为独立卡片（圆角 + 微阴影）
- 卡片有清晰的 hover 状态，暗示可点击
- 标题视觉权重更突出，元信息精简
- 状态 badge 更醒目（失败/运行中等状态一眼可见）
- 操作按钮（运行/完成）保留在卡片右侧

## 不在范围内

- TaskDetail 弹窗内容不变
- 后端 API 不变
- 任务数据结构不变
- 移动端 panel 头部不变

## 方案设计

### 前端变更

**文件**: `packages/web/src/index.css`  
**文件**: `packages/web/src/views/components/TaskRail.tsx`（CSS class 名微调）

#### 卡片容器 `.pulse-task-list`
- 改为 `display: flex; flex-direction: column; gap: 6px`（卡片间距）
- 移除 `padding-right: 2px`，改为 `padding: 4px 0`

#### 卡片本身 `.pulse-task-compact`
- 改为独立卡片样式：
  - `background: var(--bg)`
  - `border: 1px solid var(--border)`
  - `border-radius: 10px`
  - `box-shadow: 0 1px 3px rgba(0,0,0,0.06)`
  - `padding: 10px 12px`（替代原来的 `padding: 8px 0 !important`）
  - `cursor: pointer`
  - `transition: box-shadow 0.15s, border-color 0.15s`
- hover 状态：
  - `border-color: var(--border-strong)`
  - `box-shadow: 0 2px 8px rgba(0,0,0,0.10)`
- 选中状态（`.is-selected`）：
  - `border-color: var(--accent, #4f46e5)`（蓝色边框）
  - `box-shadow: 0 0 0 2px rgba(79,70,229,0.12)`

#### 标题 `.pulse-task-compact-main strong`
- 字号从 12px 改为 13px
- `font-weight: 600`（加粗）
- 保留 `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`

#### 元信息行 `.pulse-task-compact-meta`
- 精简为：状态 badge + 分隔点 + assignee + kind
- 移除 icon（SparkIcon/ClockIcon），改用纯文字 `AI · 周期` 格式
- 字号保持 11px，`gap: 4px`

#### 操作按钮 `.pulse-task-compact-actions`
- 默认 `opacity: 0`，hover 时 `opacity: 1`（卡片 hover 时显示）
- 按钮尺寸 28px，`border-radius: 8px`

#### 移除旧的分割线
- `.pulse-task-card` 的 `border-bottom` 在 compact 模式下不需要（卡片间距代替）
- 通过 `.pulse-task-compact` 覆盖 `border-bottom: 0`

### JSX 调整（TaskRail.tsx）

元信息区域简化：去掉 `SparkIcon` 和 `ClockIcon` 的 wrapper，改为纯文字 `· AI · 周期` 格式拼接。

## 验收标准

- [ ] 每个任务卡片有圆角和微阴影，视觉上独立
- [ ] 鼠标 hover 卡片时有边框加深 + 阴影加大效果
- [ ] 点击卡片后有选中高亮（蓝色边框）
- [ ] 标题字体比元信息明显更大/更粗
- [ ] 操作按钮默认隐藏，hover 时显示
- [ ] 失败/运行中等状态 badge 清晰可见
- [ ] 卡片之间有适当间距（不再是分割线）

## 备注

仅修改 CSS 和少量 JSX（元信息简化），不涉及逻辑变更。
