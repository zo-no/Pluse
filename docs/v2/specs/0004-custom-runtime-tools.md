# Spec 0004 — 自定义 Runtime 工具

关联需求：[0004-custom-runtime-tools](../requirements/0004-custom-runtime-tools.md)

## 概述

用户可在设置页面添加自定义 Runtime 工具（名称、命令、Runtime Family），配置持久化到 `~/.pluse/runtime-tools.json`，后端读取后合并到工具列表 API，前端工具选择列表动态展示。

---

## 数据模型

### 自定义工具配置文件

路径：`~/.pluse/runtime-tools.json`

```json
{
  "tools": [
    {
      "id": "opencode",
      "name": "OpenCode",
      "command": "opencode",
      "runtimeFamily": "claude-stream-json"
    }
  ]
}
```

字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识，由名称自动生成（slug），用户不可手动填写 |
| `name` | string | 显示名称，如 `OpenCode` |
| `command` | string | 执行命令，可含固定参数，如 `opencode` 或 `opencode --json` |
| `runtimeFamily` | `'claude-stream-json' \| 'codex-json'` | 输出协议类型 |

`id` 生成规则：取 `name` 小写 + 去非字母数字字符替换为 `-`，若与内置工具或已有自定义工具冲突则追加数字后缀。

---

## 后端

### 新增文件：`packages/server/src/runtime/custom-tools.ts`

职责：读写 `~/.pluse/runtime-tools.json`

```ts
export function readCustomTools(): CustomRuntimeToolConfig[]
export function writeCustomTools(tools: CustomRuntimeToolConfig[]): void
export function addCustomTool(input: Omit<CustomRuntimeToolConfig, 'id'>): CustomRuntimeToolConfig
export function removeCustomTool(id: string): boolean
```

### 修改：`packages/server/src/runtime/catalog.ts`

`listRuntimeTools()` 改为合并内置工具 + 自定义工具：

```ts
export function listRuntimeTools(): RuntimeTool[] {
  const builtin = BUILTIN_TOOLS.map(...)
  const custom = readCustomTools().map((tool) => ({
    ...tool,
    builtin: false,
    available: true, // 暂不检测，后续再加
  }))
  return [...builtin, ...custom]
}
```

### 新增 HTTP 路由

在 `packages/server/src/controllers/http/` 新增 `runtime-tools.ts`：

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/api/runtime-tools/custom` | 获取自定义工具列表 |
| `POST` | `/api/runtime-tools/custom` | 添加自定义工具 |
| `DELETE` | `/api/runtime-tools/custom/:id` | 删除自定义工具 |

POST body：
```json
{
  "name": "OpenCode",
  "command": "opencode",
  "runtimeFamily": "claude-stream-json"
}
```

注册到 `packages/server/src/server.ts`。

---

## 前端

### 设置页面新增「自定义工具」区块

位置：`packages/web/src/views/pages/SettingsPage.tsx`，新增一个 section。

UI 结构：
- 已添加工具列表（名称、命令、Family、删除按钮）
- 「添加工具」表单（内联展开或小弹窗）：
  - 名称输入框
  - 命令输入框（placeholder: `opencode`）
  - Runtime Family 选择（`claude-stream-json` / `codex-json`）
  - 确认按钮

### 新增 API client 方法

在 `packages/web/src/api/client.ts` 新增：

```ts
export async function getCustomRuntimeTools(): Promise<ApiResult<CustomRuntimeToolConfig[]>>
export async function addCustomRuntimeTool(input: {...}): Promise<ApiResult<CustomRuntimeToolConfig>>
export async function removeCustomRuntimeTool(id: string): Promise<ApiResult<void>>
```

---

## 类型定义

在 `packages/types/src/` 新增或扩展：

```ts
export interface CustomRuntimeToolConfig {
  id: string
  name: string
  command: string
  runtimeFamily: 'claude-stream-json' | 'codex-json'
}
```

`RuntimeTool`（已有）的 `builtin` 字段区分内置/自定义。

---

## 验收标准

1. 在设置页面添加 `opencode` 工具后，任务创建 Modal 的工具列表出现 OpenCode
2. 删除后从列表消失
3. 重启服务后自定义工具仍存在
4. 添加时 `name` 和 `command` 为必填，为空时按钮禁用
5. 内置工具（codex / claude / mc）不可删除
6. `id` 与已有工具冲突时自动加后缀，不报错
