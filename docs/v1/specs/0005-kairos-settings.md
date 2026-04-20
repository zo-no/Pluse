# 0005 — Kairos 语音播报设置

**状态**: approved  
**优先级**: medium  
**估算**: S

## 背景

kairos 是独立的语音播报 CLI 工具，与 Pluse 通过 shell hook action 集成。目前启用语音播报需要手动编辑 `~/.pluse/hooks.json`，对普通用户门槛过高。

本 spec 在 Pluse 设置页的"通知"section 新增语音播报区块，支持：
1. 检测 kairos 是否已安装
2. 未安装时提供一键安装
3. 已安装时提供开关控制是否启用

## 目标

- 设置页展示 kairos 安装状态
- 未安装时显示"一键安装"按钮，点击后自动完成安装
- 已安装时提供开关，toggle `speak-on-session-complete` hook
- 安装过程有 loading 状态，安装完成后自动刷新状态

## 不在范围内

- kairos 版本管理 / 升级
- voice 选择（用 `kairos config set voice` 命令行配置）
- 安装日志实时流式展示（只显示成功/失败）
- Windows / Linux 支持

## 方案设计

### 后端变更

#### 1. 新增 `GET /api/tools/kairos`

检测 kairos 是否可用：

```typescript
// packages/server/src/controllers/http/tools.ts
toolsRouter.get('/tools/kairos', async (c) => {
  const result = Bun.spawnSync(['which', 'kairos'], {
    env: { ...process.env, PATH: expandPath() },
  })
  const installed = result.exitCode === 0
  const path = installed ? new TextDecoder().decode(result.stdout).trim() : null
  return c.json({ ok: true, data: { installed, path } })
})
```

**PATH 处理**：Pluse server 进程的 PATH 可能不含 `~/.bun/bin`，需要在检测时补全：

```typescript
function expandPath(): string {
  const home = process.env.HOME ?? ''
  const extra = [
    `${home}/.bun/bin`,
    `${home}/.local/bin`,
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]
  const current = process.env.PATH ?? ''
  return [...extra, current].join(':')
}
```

#### 2. 新增 `POST /api/tools/kairos/install`

执行安装命令，使用异步 `Bun.spawn()` 避免阻塞 event loop：

```typescript
// 防并发锁
let installLock = false

toolsRouter.post('/tools/kairos/install', async (c) => {
  // 防止并发安装
  if (installLock) {
    return c.json({ ok: false, error: 'installation already in progress' }, 409)
  }
  installLock = true

  try {
    const home = process.env.HOME ?? ''
    const binDir = `${home}/.bun/bin`
    const outfile = `${binDir}/kairos`
    const tmpDir = `${home}/.pluse/tmp/kairos-install`
    const env = { ...process.env, PATH: expandPath() }

    // 清理可能存在的旧 tmpDir
    await Bun.spawn(['rm', '-rf', tmpDir], { env }).exited

    // clone
    const cloneProc = Bun.spawn(
      ['git', 'clone', '--depth=1', 'https://github.com/zo-no/kairos.git', tmpDir],
      { env, stdout: 'pipe', stderr: 'pipe' }
    )
    const cloneExit = await cloneProc.exited
    if (cloneExit !== 0) {
      const stderr = await new Response(cloneProc.stderr).text()
      await Bun.spawn(['rm', '-rf', tmpDir], { env }).exited
      return c.json({ ok: false, error: `clone failed: ${stderr.trim()}` }, 500)
    }

    // 确保输出目录存在
    await Bun.spawn(['mkdir', '-p', binDir], { env }).exited

    // build
    const buildProc = Bun.spawn(
      ['bun', 'build', '--compile', `--outfile=${outfile}`, 'src/index.ts'],
      { cwd: tmpDir, env, stdout: 'pipe', stderr: 'pipe' }
    )
    const buildExit = await buildProc.exited

    // cleanup tmp
    await Bun.spawn(['rm', '-rf', tmpDir], { env }).exited

    if (buildExit !== 0) {
      const stderr = await new Response(buildProc.stderr).text()
      return c.json({ ok: false, error: `build failed: ${stderr.trim()}` }, 500)
    }

    return c.json({ ok: true, data: { path: outfile } })
  } finally {
    installLock = false
  }
})
```

**关键设计决策：**
- 使用 `Bun.spawn()` + `await proc.exited` 而非 `Bun.spawnSync()`，避免阻塞 Bun event loop（安装约 15-30s）
- `installLock` 防止并发安装请求
- 安装前先 `rm -rf tmpDir` 处理旧残留目录
- `mkdir -p binDir` 确保 `~/.bun/bin` 存在
- 错误响应包含 stderr 内容，方便诊断

#### 3. 路由注册（`server.ts`）

```typescript
import { toolsRouter } from './controllers/http/tools'
app.route('/api', toolsRouter)
```

### 前端变更

#### 1. API client 支持 timeout（`packages/web/src/api/client.ts`）

`request()` 函数新增可选 `options` 参数，支持 `timeout`（毫秒）：

```typescript
interface RequestOptions {
  timeout?: number  // ms，默认无超时
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions
): Promise<ApiResult<T>> {
  const controller = options?.timeout ? new AbortController() : undefined
  const timer = controller
    ? setTimeout(() => controller.abort(), options!.timeout!)
    : undefined

  try {
    const res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: controller?.signal,
    })
    // ... 现有响应处理逻辑不变
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, error: 'Request timed out' }
    }
    return { ok: false, error: String(err) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
```

新增 API 方法：

```typescript
export interface KairosStatus {
  installed: boolean
  path: string | null
}

export function getKairosStatus(): Promise<ApiResult<KairosStatus>> {
  return request<KairosStatus>('GET', '/tools/kairos')
}

export function installKairos(): Promise<ApiResult<{ path: string }>> {
  return request<{ path: string }>('POST', '/tools/kairos/install', undefined, { timeout: 60000 })
}
```

#### 2. SettingsPage 新增语音播报区块

在"通知"section 末尾追加：

```tsx
const SPEAK_HOOK_ID = 'speak-on-session-complete'

// state
const [kairosInstalled, setKairosInstalled] = useState<boolean | null>(null) // null = 检测中
const [kairosInstalling, setKairosInstalling] = useState(false)
const [kairosError, setKairosError] = useState<string | null>(null)
const [speakOnComplete, setSpeakOnComplete] = useState(false)

// 加载时检测 kairos
async function loadKairosStatus() {
  const result = await api.getKairosStatus()
  if (!result.ok) { setKairosInstalled(false); return }
  setKairosInstalled(result.data.installed)
}

// loadHooks 中同步加载 speak hook 状态
const speakHook = result.data.hooks.find((h) => h.id === SPEAK_HOOK_ID)
setSpeakOnComplete(speakHook ? speakHook.enabled === true : false)

// 一键安装
async function handleInstallKairos() {
  setKairosInstalling(true)
  setKairosError(null)
  const result = await api.installKairos()
  setKairosInstalling(false)
  if (!result.ok) {
    setKairosError(result.error ?? '安装失败')
    return
  }
  setKairosInstalled(true)
}

// toggle 开关
async function handleToggleSpeak(enabled: boolean) {
  setSpeakOnComplete(enabled)
  setHookSaving(true)
  await api.updateHook(SPEAK_HOOK_ID, enabled)
  setHookSaving(false)
}
```

**UI 结构：**

```tsx
<div className="pluse-settings-toggle-row">
  <div className="pluse-settings-toggle-info">
    <span className="pluse-settings-toggle-label">{t('会话完成后语音播报')}</span>
    <span className="pluse-settings-toggle-desc">
      {kairosInstalled === null
        ? t('检测中…')
        : kairosInstalled
        ? t('由 kairos 驱动，可用 kairos config set voice Tingting 切换音色')
        : kairosError
        ? kairosError
        : t('需要先安装 kairos')}
    </span>
  </div>
  {kairosInstalled === null ? (
    <span className="pluse-settings-toggle-loading">…</span>
  ) : kairosInstalled ? (
    <button
      type="button"
      role="switch"
      aria-checked={speakOnComplete}
      className={`pluse-settings-toggle${speakOnComplete ? ' is-on' : ''}`}
      onClick={() => void handleToggleSpeak(!speakOnComplete)}
      disabled={hookLoading || hookSaving}
    >
      <span className="pluse-settings-toggle-thumb" />
    </button>
  ) : (
    <button
      type="button"
      className="pluse-button pluse-button-sm"
      onClick={() => void handleInstallKairos()}
      disabled={kairosInstalling}
    >
      {kairosInstalling ? t('安装中…') : t('一键安装')}
    </button>
  )}
</div>
```

无新增样式，复用现有 `pluse-settings-toggle-row`、`pluse-button`、`pluse-button-sm` 类。

## 测试方案

### 手动测试

1. **未安装状态**：临时 rename `~/.bun/bin/kairos`，刷新设置页，确认显示"一键安装"按钮
2. **一键安装**：点击安装，确认 loading 状态（按钮显示"安装中…"且 disabled），安装完成后开关出现
3. **安装失败**：断网后点击安装，确认错误信息显示在 desc 区域
4. **并发防护**：快速双击安装按钮（前端 disabled 已阻止，后端也有 409 保护）
5. **开关 toggle**：开启后确认 `~/.pluse/hooks.json` 中 `speak-on-session-complete.enabled` 为 true
6. **语音验证**：触发一次会话完成，确认播报

## 验收标准

- [ ] `GET /api/tools/kairos` 正确检测安装状态，PATH 包含 `~/.bun/bin`
- [ ] `POST /api/tools/kairos/install` 使用异步 `Bun.spawn()`，不阻塞 event loop
- [ ] `POST /api/tools/kairos/install` 安装成功后 `which kairos` 可找到
- [ ] `POST /api/tools/kairos/install` 错误响应包含 stderr 内容
- [ ] `POST /api/tools/kairos/install` 并发请求返回 409
- [ ] 前端 `installKairos()` 设置 60s 超时，超时后显示错误
- [ ] 设置页检测中显示 loading
- [ ] 未安装时显示"一键安装"按钮，安装中 disabled
- [ ] 安装失败时 desc 区域显示错误信息
- [ ] 安装完成后自动切换为开关状态
- [ ] 开关 toggle 正确更新 `speak-on-session-complete` hook
- [ ] 已安装时 desc 显示 kairos 提示文字

## 备注

- 安装超时设 60s，后端 clone + build 实测约 15-30s
- `~/.pluse/tmp/` 用于临时文件，安装后清理；安装前先清理旧残留
- `~/.bun/bin` 目录不一定存在，安装前需 `mkdir -p`
- 安装失败时显示错误文字，不崩溃
- 未来可扩展：显示 kairos 版本号（`kairos --version`）、升级按钮
