# 0007 — 文件附件上传

**状态**: approved  
**优先级**: medium  
**估算**: M

## 背景

ChatView 输入框目前只支持纯文本。melodysync 的附件方案经过验证：不依赖 CLI 的 `--file` 参数，而是将附件本地路径拼入 prompt 前缀，对 claude 和 codex 行为一致。

## 方案设计

### 附件传递机制（同 melodysync）

发送消息前，将附件引用拼到 prompt 最前面：

```
[User attached image: photo.png -> /Users/kual/.pulse/assets/sess_xxx/photo.png]
[User attached file: report.pdf -> /Users/kual/.pulse/assets/sess_xxx/report.pdf]

用户的消息内容
```

AI 通过 Read 工具（claude）或直接读文件系统（codex）访问附件。

### 后端

**上传端点**：`POST /api/assets/upload`

- Content-Type: `multipart/form-data`
- 字段：`file`（文件）、`sessionId`（归属会话）
- 存储路径：`~/.pulse/assets/{sessionId}/{timestamp}-{filename}`
- 返回：`{ assetId, filename, savedPath, mimeType, sizeBytes }`
- 限制：单文件 20MB

**Asset 模型**（内存，不持久化到 DB）：
```typescript
interface Asset {
  id: string        // 'asset_' + hex
  sessionId: string
  filename: string
  savedPath: string
  mimeType: string
  sizeBytes: number
  createdAt: string
}
```

**`prependAttachmentPaths(prompt, attachments)`**：
- 根据 mimeType 判断 label：`image/` → `image`，`video/` → `video`，其余 → `file`
- 格式：`[User attached {label}: {filename} -> {savedPath}]`

### 前端

**ChatView 变更**：
- 输入框左侧加附件按钮（📎），点击触发 `<input type="file" multiple>`
- 支持粘贴图片（`paste` 事件）
- 选中后显示预览条（文件名 + 删除按钮）
- 发送时先上传所有附件，拿到 savedPath，再拼 prompt 发送
- 最多 4 个附件，单文件 20MB

### session-runner 变更

`buildPrompt` 或发送前处理：如果消息带附件，调用 `prependAttachmentPaths` 拼入 prompt。

## API

```
POST /api/assets/upload          上传文件
GET  /api/assets/:id             获取 asset 信息
DELETE /api/assets/:id           删除 asset（可选）
```

`SendMessageInput` 新增字段：
```typescript
attachments?: Array<{
  assetId: string
  filename: string
  savedPath: string
  mimeType: string
}>
```

## 验收标准

- [ ] 点击附件按钮可选文件，粘贴图片自动添加
- [ ] 预览条显示已选附件，可逐个删除
- [ ] 发送时附件路径拼入 prompt 前缀
- [ ] claude 和 codex 行为一致
- [ ] 超过 20MB 或超过 4 个时提示错误
