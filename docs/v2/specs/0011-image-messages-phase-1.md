# 0011 — Image Messages Phase 1

**状态**: draft
**类型**: spec
**关联 requirement**: `docs/v2/requirements/0011-image-messages.md`
**关联 design**: `docs/v2/designs/0011-image-messages.md`

## 本期目标

Phase 1 完成“消息可以发图片”的最小闭环：

- 用户上传或粘贴图片后，消息历史中能显示图片
- AI 生成图片后，图片被导入当前 Quest asset，并在消息流中显示
- 图片通过受控 API 提供给前端，不暴露任意本机路径
- 现有文本消息、附件 prompt、follow-up queue 和 Run 流程保持稳定

本期不做图片编辑器、素材库、公开分享和缩略图服务。

## 本期范围

### 1. 类型扩展

影响文件：

- `packages/types/src/api.ts`
- `packages/types/src/quest.ts`

新增类型：

```typescript
export interface QuestEventAsset {
  assetId: string
  filename: string
  mimeType: string
  sizeBytes?: number
}
```

扩展：

```typescript
export interface QuestEvent {
  assets?: QuestEventAsset[]
}
```

`QueuedMessage` 增加可选字段，用于忙时排队后回放图片：

```typescript
assets?: QuestEventAsset[]
```

兼容要求：

- 所有新增字段必须可选
- 旧 history JSON 不迁移
- 旧事件没有 `assets` 时前端行为不变

### 2. Asset 文件访问 API

影响文件：

- `packages/server/src/controllers/http/assets.ts`
- `packages/server/src/models/asset.ts`（如需增加 helper）
- `packages/server/src/support/paths.ts`（如需复用路径校验 helper）

新增端点：

```text
GET /api/assets/:id/file
```

行为：

1. 通过 `getAsset(id)` 查元数据，不存在返回 `404`
2. 计算 `getAssetsDir(asset.questId)`，校验 `asset.savedPath` resolve 后位于该目录内
3. 文件不存在返回 `404`
4. 返回 `Bun.file(asset.savedPath)`，设置：
   - `Content-Type: asset.mimeType`
   - `Content-Disposition: inline; filename="<safe filename>"`
   - 可选 `Cache-Control: private, max-age=3600`

安全要求：

- 不接受路径参数
- 不根据 query 读取任意文件
- 路径校验失败返回 `404` 或 `403`
- 不改变现有 `GET /api/assets/:id` 元数据接口

### 3. 用户图片消息事件

影响文件：

- `packages/server/src/runtime/session-runner.ts`
- `packages/server/src/controllers/http/quests.ts`（仅类型流通，如需）
- `packages/web/src/views/components/ChatView.tsx`

服务端行为：

- `SubmitQuestMessageInput.attachments` 继续用于 prompt 拼接
- 追加用户 `message` 事件时，将附件转为 `QuestEventAsset[]` 写入事件 `assets`
- 排队消息入队时保存 `assets`
- `maybeStartNextFollowUp` 追加排队用户消息事件时携带 `assets`

转换规则：

```text
MessageAttachment -> QuestEventAsset
assetId, filename, mimeType
```

如果后续需要 `sizeBytes`，可从 upload result 或 asset model 补充；本期不是硬要求。

### 4. AI 生成图片导入

影响文件：

- `packages/server/src/runtime/session-runner.ts`
- `packages/server/src/models/asset.ts`
- `packages/server/src/support/paths.ts`

新增内部能力：

```typescript
function importGeneratedImageAssets(questId: string, event: ProviderEvent): QuestEventAsset[]
```

建议实现方向：

1. 从 `event.content / event.output / event.bodyPreview / event.toolInput` 中扫描图片路径
2. 只接受以下根目录内的文件：
   - `getManagedCodexHome()/generated_images`
   - 兼容实际环境中的 `~/.pluse/system/codex-home/generated_images`
3. 只接受图片扩展名：
   - `.png`
   - `.jpg`
   - `.jpeg`
   - `.webp`
   - `.gif`
4. 文件存在且是普通文件后，复制到 `getAssetsDir(questId)`
5. 文件名使用安全前缀，避免覆盖：
   - `generated-${Date.now()}-${basename}`
6. 调用 `createAsset` 登记
7. 返回 `QuestEventAsset[]`

集成点：

- 在 `appendQuestEvents(questId, events)` 写入事件前，对每个 provider event 执行导入
- 如果导入得到 assets，把 `assets` 合并到该事件后再 append
- 导入异常 catch 后忽略，只保留原事件文本

去重要求：

- 同一个 provider event 内重复出现同一路径，只导入一次
- 本期不要求跨事件全局去重

明确不做：

- 不导入任意绝对路径
- 不删除原图
- 不把导入失败升级为 Run 失败
- 不解析远程图片 URL

### 5. 前端图片渲染

影响文件：

- `packages/web/src/views/components/ChatView.tsx`
- `packages/web/src/index.css`
- `packages/web/src/i18n.tsx`（如需新增文案）

新增渲染能力：

- `MessageEventCard` 渲染 `event.assets`
- `MetaEventEntry` 或 meta group 渲染带图片的工具结果 / 状态事件
- 图片 URL 使用：

```typescript
`/api/assets/${asset.assetId}/file`
```

展示规则：

- 只对 `mimeType.startsWith('image/')` 渲染 `<img>`
- 多图使用 wrap 网格，避免撑破消息列
- 图片最大宽度不超过消息容器
- 加载失败显示文件名占位
- 旧文本消息样式不变

CSS 约束：

- 图片容器有稳定 max-width
- 移动端不横向溢出
- 不改变 composer 尺寸逻辑

### 6. 测试与验证

后端测试建议覆盖：

- 上传图片后发送消息，history 事件包含 `assets`
- 忙时发送带图片消息，follow-up queue 保留 `assets`，执行后事件仍包含 `assets`
- `/api/assets/:id/file` 返回图片 bytes 和正确 MIME
- `savedPath` 不在 Quest asset 目录时，文件访问被拒绝
- 生成图片路径在可信目录内时会复制并登记 asset
- 生成图片导入失败不导致 Run 失败

前端验证建议覆盖：

- 用户消息图片展示
- 助手或工具结果图片展示
- 图片加载失败占位
- 纯文本消息无视觉回归

命令级验证：

```bash
bun test packages/server/src/__tests__/quest-todo-run.test.ts
bun test
```

如果前端项目有独立检查命令，补跑对应 typecheck/build。

## 数据与迁移

本期不需要数据库迁移。

原因：

- `assets` 表已存在
- Quest history 事件保存在 JSON 文件中
- `assets` 是可选 JSON 字段，旧事件无需回写

## 回滚策略

如果上线后出现问题，可按以下顺序回滚：

1. 前端停止渲染 `event.assets`，保留文本消息
2. 服务端停止导入生成图片，保留原 provider 事件
3. 保留 `/api/assets/:id/file` 不影响现有元数据接口
4. 如需完全回滚，删除新增可选字段使用点，旧 history 不需要迁移

## 验收标准

1. 用户上传或粘贴图片并发送后，当前 Quest 消息流显示图片
2. 重新打开同一 Quest 后，图片仍能显示
3. AI 生成图片输出后，图片进入当前 Quest asset 并在消息流显示
4. 图片文件通过 `/api/assets/:id/file` 加载，不使用 `file://` 或绝对路径
5. 旧纯文本消息正常显示
6. 生成图片导入失败不会让 Run 失败
7. 不能通过 asset 文件接口读取 asset 目录外文件

## 明确不做

- 不支持公开分享链接
- 不支持图片删除 UI
- 不支持图片 lightbox
- 不支持缩略图缓存
- 不支持任意本地路径转图片消息
- 不改变 provider prompt 的附件拼接方式
