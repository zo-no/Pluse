# 0011 — Image Messages

**状态**: draft
**类型**: design
**关联 requirement**: `docs/v2/requirements/0011-image-messages.md`

## 设计目标

这份 design 要解决的是：

- 如何让 Quest 消息和运行事件安全承载图片资产
- 如何让用户上传图片和 AI 生成图片都能在消息流中回放
- 如何在不重写 history / Run 主线的前提下补齐图片展示闭环

本设计优先追求小范围、向后兼容、可降级。

## 设计立场

- `Asset-first`
  - 前端展示图片时只引用已登记 asset，不直接引用本机绝对路径

- `Event-compatible`
  - 图片是 Quest event 的可选附加信息，不改变现有事件主结构

- `Import, don't move`
  - AI 生成图片进入 Quest 时复制到 Quest asset 目录，保留原始文件

- `Failure is non-blocking`
  - 图片导入或展示失败不应导致消息发送、Run 完成或旧历史渲染失败

## 非目标

这份 design 不讨论：

- 图片编辑、裁剪、标注
- 独立素材管理后台
- 云端公开访问
- 图片缩略图生成服务
- 支持所有 provider 的私有图片输出格式
- 对任意本机图片路径建立浏览器访问能力

## 核心能力结构

### 1. Quest Event Media

在现有 `QuestEvent` 上增加可选媒体引用，而不是新建一套消息表。

概念结构：

```typescript
interface QuestEventAsset {
  assetId: string
  filename: string
  mimeType: string
  sizeBytes?: number
}

interface QuestEvent {
  // existing fields...
  assets?: QuestEventAsset[]
}
```

含义：

- `assets` 只描述该事件可展示的媒体或附件引用
- 图片展示由 `mimeType.startsWith('image/')` 决定
- 旧事件没有 `assets` 时按纯文本展示
- 事件正文 `content` 继续保留，用于文本说明、prompt 上下文和历史兼容

### 2. Asset File Delivery

新增受控 asset 文件访问能力：

```text
GET /api/assets/:id/file
```

它只服务已经登记到 `assets` 表的文件。

访问约束：

- 先通过 `assetId` 查询 asset 元数据
- 校验文件路径仍位于 `~/.pluse/assets/{questId}` 下
- 只返回实际存在的文件
- 使用 asset 的 `mimeType` 设置 `Content-Type`
- 默认 inline 展示，不提供任意路径读取

这让前端可以用稳定 URL 渲染图片，而不是依赖本机绝对路径。

### 3. User Image Message

用户上传或粘贴图片时，现有上传流程继续工作：

1. 前端上传文件到 `/api/assets/upload`
2. 服务端把文件保存到 `~/.pluse/assets/{questId}`
3. `submitQuestMessage` 继续把路径拼入 prompt，让 AI 能读取
4. 追加用户消息事件时，把这些附件同步写入 `event.assets`
5. 前端用 `/api/assets/:id/file` 渲染图片

这样既保留“AI 可读本地文件”的现有行为，也补齐“用户可回看图片”的消息体验。

### 4. Generated Image Import

AI 生成图片的导入不应依赖浏览器直接读取生成目录。

运行时在 provider 事件中发现可信图片路径时执行导入：

1. 识别事件内容中的本地图片路径
2. 只接受 Pluse 管理的 Codex 生成目录下的图片，例如 `~/.pluse/system/codex-home/generated_images`
3. 校验文件存在、扩展名和 MIME 类型为图片
4. 复制到当前 Quest asset 目录
5. 调用 asset model 登记元数据
6. 把生成的 asset 引用附加到对应 `QuestEvent.assets`

安全边界：

- 不导入任意绝对路径
- 不删除原文件
- 不覆盖已有 Quest asset
- 导入失败只记录文本事件，不让 Run 失败

### 5. Frontend Rendering

ChatView 在现有消息和 meta event 渲染基础上增加图片条：

- 用户消息：在用户气泡下展示图片
- 助手消息：在 Markdown 内容下展示图片
- 工具结果 / 状态事件：如果带图片 asset，展开或直接显示图片预览

渲染规则：

- 图片最大宽度受消息列约束
- 多图时使用稳定网格或横向 wrap
- 图片加载失败时显示文件名占位
- 非图片附件本期可继续显示为文件名，不强制做完整文件卡片

### 6. Queue Compatibility

Session 忙时，follow-up queue 需要保留：

- prompt 使用的附件路径
- 用户可见的 display text
- 事件回放使用的 asset 引用

当排队消息真正开始执行时，追加用户消息事件时也应携带 `assets`。

## 关键设计决策

### 1. 不引入单独的 message table

当前 Quest history 以文件事件保存，前端也围绕 `QuestEvent` 渲染。

本期只增加 optional `assets` 字段：

- 旧事件无需迁移
- 现有 list / append 逻辑可以继续工作
- 风险集中在渲染和事件生成处

### 2. 不直接渲染 Markdown 里的本地路径

允许 Markdown 远程图片会引入加载、权限和隐私边界问题；允许本地绝对路径更危险。

本期只渲染 `event.assets` 中的已登记 asset。

### 3. 生成图片导入只认可信目录

为了避免把任意本机文件暴露给前端，自动导入只处理 Pluse 管理运行时生成目录下的图片。

如果未来要支持“Agent 指定任意本地图片作为输出”，应增加显式登记 API，而不是扩大自动扫描范围。

### 4. 图片能力不改变 provider prompt 结构

用户附件传给 AI 的方式仍沿用当前路径拼接机制。

本期解决展示和资产闭环，不改变 Codex / Claude 如何读取附件。

## 分期建议

### Phase 1

完成最小闭环：

- `QuestEvent.assets`
- `/api/assets/:id/file`
- 用户图片消息历史展示
- AI 生成图片从管理生成目录导入 Quest asset
- ChatView 图片渲染

### Phase 2

可选增强：

- 图片 lightbox
- 文件卡片统一展示
- 图片复制 / 另存 / 删除入口
- 缩略图缓存
- 非 Codex provider 的生成图片输出适配

## 风险与约束

- 生成图片路径输出格式可能随 provider 变化，因此导入器必须保守
- 图片文件可能被用户手动删除，前端需要加载失败降级
- 事件 history 是 JSON 文件，新增字段必须保持可选
- 不应为了图片展示扩大本地文件访问面

## 验收方向

设计完成后，Phase 1 至少应证明：

- 用户发图后消息流可回看图片
- AI 生成图后消息流可显示图片
- 旧文本消息不变
- 文件访问 API 不能读取 asset 目录外文件
- 图片导入失败不影响 Run 状态
