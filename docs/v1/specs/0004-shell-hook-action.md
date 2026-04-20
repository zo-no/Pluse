# 0004 — Shell Hook Action

**状态**: done  
**优先级**: medium  
**估算**: S

## 背景

Pluse 的 hooks 系统目前支持两种 action：`highlight_quest` 和 `create_todo`，均为内部操作。用户无法在 Quest 完成时触发外部命令（如语音播报、桌面通知、Webhook 等）。

新增 `shell` action 类型，允许 hooks 执行任意 shell 命令，实现 Pluse 与外部工具的解耦集成。典型使用场景：调用 `kairos` CLI 播报语音通知。

## 目标

- 新增 `shell` action 类型，支持执行任意 shell 命令
- 支持模板变量（含 `{{project.name}}`）
- 提供 shell 转义变体防止意外注入
- 默认异步后台执行，不阻塞 hook 流程
- 在默认配置中加入 `enabled: false` 的示例 hook

## 不在范围内

- 命令白名单 / 沙箱限制（本地工具，信任边界是文件权限）
- 命令执行结果回写到 Quest / Todo
- UI 上的 shell action 配置界面（JSON 配置即可）
- `background: false` 同步执行模式（v1 只做后台执行）
- timeout 可配置（v1 不做）

## 方案设计

### 后端变更

#### 1. 类型定义（`packages/server/src/services/hooks.ts`）

新增 `ShellAction`，并加入 `HookAction` 联合类型：

```typescript
interface ShellAction {
  type: 'shell'
  command: string  // 支持模板变量
}

type HookAction = HighlightQuestAction | CreateTodoAction | ShellAction
```

#### 2. 模板变量扩展

`renderTemplate` 新增 `{{project.name}}` 支持及 shell 转义变体 `{{*.shell}}`。

**安全说明**：POSIX sh 中单引号内是完全字面量，`$()`、反引号、`\` 均不被解释，因此单引号包裹 + `'\''` 转义能完整防护命令注入。

```typescript
function shellEscape(value: string): string {
  // 单引号内是完全字面量，' 本身用 '\'' 转义
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

function renderTemplate(
  template: string,
  ctx: { quest: Quest; run: Run; project: ReturnType<typeof getProject> }
): string {
  const projectName = ctx.project?.name ?? ''  // project 为 null 时降级为空字符串
  const questName = ctx.quest.name ?? ctx.quest.title ?? ctx.quest.id

  return template
    // .shell 变体必须先替换，避免原始变体先匹配后双重处理
    .replace(/\{\{project\.name\.shell\}\}/g, shellEscape(projectName))
    .replace(/\{\{quest\.name\.shell\}\}/g, shellEscape(questName))
    .replace(/\{\{quest\.id\.shell\}\}/g, shellEscape(ctx.quest.id))
    .replace(/\{\{run\.id\.shell\}\}/g, shellEscape(ctx.run.id))
    .replace(/\{\{project\.name\}\}/g, projectName)
    .replace(/\{\{quest\.name\}\}/g, questName)
    .replace(/\{\{quest\.id\}\}/g, ctx.quest.id)
    .replace(/\{\{run\.id\}\}/g, ctx.run.id)
}
```

**注意**：`renderTemplate` 的 ctx 类型新增 `project` 字段，**所有现有调用处**（`create_todo` 的 title/description、`highlight_quest` 路径）均需同步更新，传入 `project`。TypeScript 编译器会在调用处报错，逐一修复即可。

#### 3. `runHooks` 保持同步，无需 async 化

`Bun.spawn` + `child.unref()` 是 fire-and-forget，不需要 `await`，`runHooks` 保持 `void` 签名不变。`session-runner.ts` 的调用方无需修改。

```typescript
// runHooks 签名不变
export function runHooks(event: HookEvent, ctx: { quest: Quest; run: Run }): void
```

#### 4. shell action 执行逻辑

在 `runHooks` 的 action 循环中新增分支：

```typescript
} else if (action.type === 'shell') {
  const rendered = renderTemplate(action.command, { quest, run, project })
  try {
    const child = Bun.spawn(['sh', '-c', rendered], {
      detached: true,
      stdout: 'ignore',
      stderr: 'ignore',
    })
    child.unref()  // Bun 不等待子进程，不阻塞主流程
  } catch (error) {
    console.warn('[hooks] shell action failed to spawn:', error instanceof Error ? error.message : error)
  }
}
```

- `detached: true`：子进程独立，Pluse server 退出后命令仍可执行完毕
- `child.unref()`：Bun 进程不等待子进程，不阻塞 hook 流程
- spawn 失败只 warn，不抛出，不影响其他 action 继续执行

#### 5. 默认配置更新（`DEFAULT_HOOKS_CONFIG`）

加入一个 `enabled: false` 的示例 shell hook：

```typescript
const DEFAULT_HOOKS_CONFIG: HooksConfig = {
  hooks: [
    {
      id: 'notify-on-session-complete',
      event: 'run_completed',
      enabled: true,
      filter: { kind: 'session', triggeredBy: ['human'] },
      actions: [
        { type: 'highlight_quest' },
        { type: 'create_todo', title: '查看会话：{{quest.name}}' },
      ],
    },
    {
      id: 'speak-on-session-complete',
      event: 'run_completed',
      enabled: false,  // 安装 kairos 后通过 PATCH /api/hooks/speak-on-session-complete 启用
      filter: { kind: 'session', triggeredBy: ['human'] },
      actions: [
        {
          type: 'shell',
          command: "kairos {{project.name.shell}}，{{quest.name.shell}}完成了",
        },
      ],
    },
  ],
}
```

**启用方式**：
```bash
curl -X PATCH http://localhost:PORT/api/hooks/speak-on-session-complete \
  -H 'Content-Type: application/json' \
  -d '{"enabled": true}'
```

首次 PATCH 时 `patchHook` 会将 DEFAULT_HOOKS_CONFIG 写入 `~/.pluse/hooks.json`，之后 `runHooks` 读取该文件正常执行。

**重要设计说明**：
- `GET /api/hooks` 和 `PATCH` 使用 `loadGlobalHooksConfig`，文件不存在时返回 DEFAULT_HOOKS_CONFIG
- `runHooks` 内部使用 `loadHooksFile`，文件不存在时返回空数组（DEFAULT 不会自动执行）
- 因此，`speak-on-session-complete` 要生效，必须先通过 PATCH 将配置写入文件

**修改 command 内容**：`PATCH /api/hooks/:id` 目前只支持修改 `enabled` 字段。如需修改 `command`，直接编辑 `~/.pluse/hooks.json`，格式参考 DEFAULT_HOOKS_CONFIG 的 JSON 结构。

### 前端变更

无。hooks 配置通过 JSON 文件或 API 管理，v1 不做 UI。

## 测试方案

### 单元测试（`packages/server/src/services/hooks.test.ts`）

1. **shellEscape**
   - 普通文本 → 加单引号包裹：`hello` → `'hello'`
   - 含单引号 → 正确转义：`it's` → `'it'\''s'`
   - 空字符串 → `''`
   - 含 `$()` → 包裹后不展开（验证 sh -c 执行结果）

2. **renderTemplate**
   - `{{project.name}}` 正确替换
   - `{{quest.name.shell}}` 含单引号时正确转义
   - `.shell` 变体先于原始变体替换，不双重处理
   - project 为 null 时 `{{project.name}}` 降级为空字符串

3. **runHooks — shell action**
   - 触发时调用 `Bun.spawn`（mock）
   - spawn 抛出异常时只 warn，不影响后续 action 执行
   - rendered command 正确传入 `sh -c`

4. **matchesFilter 回归**
   - shell action 的存在不影响过滤逻辑

### 集成测试（手动，两阶段）

**阶段一：验证 hook 执行路径**

直接写入 `~/.pluse/hooks.json`，绕过 API，验证 `runHooks` → `Bun.spawn` 路径：

```json
{
  "hooks": [
    {
      "id": "test-echo",
      "event": "run_completed",
      "enabled": true,
      "filter": { "kind": "session", "triggeredBy": ["human"] },
      "actions": [
        { "type": "shell", "command": "echo 'hook fired: {{quest.name}}' >> /tmp/kairos-test.log" }
      ]
    }
  ]
}
```

触发一次 session Quest 完成，检查 `/tmp/kairos-test.log` 是否有输出，验证 `{{quest.name}}` 正确渲染。

**阶段二：验证 patchHook 路径**

删除 `~/.pluse/hooks.json`，通过 API 启用示例 hook：

```bash
curl -X PATCH http://localhost:PORT/api/hooks/speak-on-session-complete \
  -H 'Content-Type: application/json' \
  -d '{"enabled": true}'
```

确认 `~/.pluse/hooks.json` 被创建，且 `speak-on-session-complete` 的 `enabled` 为 `true`。

**阶段三：含特殊字符的 Quest name**

将某个 Quest 名称改为含单引号（如 `it's done`），触发完成，验证 shell 命令不报错。

## 验收标准

- [x] `ShellAction` 类型定义完整，通过 TypeScript 编译
- [x] 所有 `renderTemplate` 调用处更新为传入 `project`，编译通过
- [x] `runHooks` 签名保持 `void`，不改为 async
- [x] `{{project.name}}` 模板变量正确渲染
- [x] `{{quest.name.shell}}` 对含单引号的名称正确转义
- [x] shell action 使用 `detached: true` + `unref()`，不阻塞主流程
- [x] spawn 失败时 console.warn，不影响其他 action 执行
- [x] 默认配置包含 `enabled: false` 的 speak 示例 hook
- [x] 单元测试全部通过（16 个测试）
- [x] 集成测试阶段一：echo 写文件验证 hook 触发
- [x] 集成测试阶段二：PATCH API 写入文件后 hook 生效
- [x] 集成测试阶段三：含单引号 Quest name 不导致 shell 报错

## 备注

- `project` 对象在 `runHooks` 中已有 `getProject(quest.projectId)` 查询，加 `{{project.name}}` 零额外成本
- shell action 不做命令限制，hooks.json 是本地用户文件，信任边界是文件系统权限
- `quest.id` / `run.id` 为 UUID 格式，不含特殊字符，`.shell` 变体提供是为接口对称性，非安全必须
- 未来如需同步执行（`background: false`）或 timeout 可配置，在此 spec 上扩展
