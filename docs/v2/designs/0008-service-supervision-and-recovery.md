# 0008 — 服务常驻与自动恢复设计方案

**状态**: draft
**类型**: design
**关联 requirement**: `docs/v2/requirements/0008-service-supervision-and-recovery.md`

## 设计目标

将 Pluse 从“依赖临时终端的开发进程”提升为“本机可常驻的用户级服务”，同时保留现有 `pnpm dev` 开发体验。

## 设计立场

- `Local-first`
  - 当前优先解决 macOS 本机用户级常驻，不引入远程部署复杂度。
- `Supervisor-owned`
  - 进程保活交给系统 supervisor，而不是让 Pluse 自己递归守护自己。
- `CLI as control plane`
  - 用户和 Agent 都通过稳定 CLI 命令查询、启动、停止、重启服务。
- `Observable before clever`
  - 先把运行状态、端口、PID、日志位置暴露清楚，再做更复杂的自动修复。
- `Dev/prod split`
  - `pnpm dev` 是开发入口；常驻服务使用构建产物和稳定日志。

## 能力边界

本设计关注 Pluse 自身 HTTP 服务的常驻和恢复：

- 管理对象：本机 Pluse server 进程
- 作用范围：用户级服务，不需要 root 权限
- 运行模式：常驻模式使用构建后的 server entry
- 平台范围：第一期优先 macOS LaunchAgent

不管理：

- 单个 Quest Run 的 AI 子进程保活
- Codex / Claude provider 的账号可用性
- 数据库损坏修复
- 多机器部署

## 推荐方案

### 方案 A（推荐）：macOS LaunchAgent + Pluse CLI 管理

Pluse 提供一组服务管理命令：

- `pluse service install`
- `pluse service uninstall`
- `pluse service start`
- `pluse service stop`
- `pluse service restart`
- `pluse service status`
- `pluse service logs`

`install` 写入用户级 LaunchAgent plist，配置：

- `RunAtLoad = true`
- `KeepAlive = true`
- 固定工作目录为当前 Pluse 仓库
- 标准输出和错误输出写入 `~/.pluse/logs/`
- 环境变量使用 Pluse 运行时默认值或安装时捕获的必要路径

常驻服务启动构建产物，而不是启动 `pnpm dev`：

- 先要求 `pnpm build` 已完成
- 服务命令指向 `packages/server/dist/server.js`
- 前端由后端静态服务 `packages/web/dist`

### 方案 B：后台 shell + pidfile

用 `nohup` / `setsid` / pidfile 管理进程。

优点：

- 实现简单
- 不依赖 LaunchAgent

缺点：

- 崩溃恢复弱
- 登录后不会自动启动
- pidfile 容易陈旧
- 不符合“长期常驻服务”的目标

### 方案 C：Pluse 内置 watchdog

启动一个 Pluse 自己的监控进程，由它拉起 server。

优点：

- 跨平台空间更大

缺点：

- 会重新实现 supervisor 能力
- 自身也需要被守护
- 增加进程模型复杂度

### 选型

采用方案 A。

理由：当前目标是 macOS 本机长期使用，LaunchAgent 正好提供登录自启、崩溃重启、日志落盘和用户级权限边界。Pluse 只需要提供标准 CLI 封装，不需要自造进程管理器。

## 用户体验模型

### 日常使用

用户安装一次服务：

```bash
pluse service install
pluse service start
```

之后打开：

```text
http://localhost:7760
```

机器重启或用户重新登录后，服务自动恢复。

### 状态排查

用户或 Agent 执行：

```bash
pluse service status --json
```

返回结构需要表达：

- `installed`
- `loaded`
- `running`
- `pid`
- `port`
- `health`
- `startedAt`
- `plistPath`
- `stdoutLogPath`
- `stderrLogPath`
- `lastError`

### 开发模式

开发仍使用：

```bash
pnpm dev
```

如果常驻服务正在占用 7760，开发模式应给出明确提示：先停止常驻服务，或设置其他端口。

## 状态来源

状态查询由三类信息合并：

1. LaunchAgent 状态
   - 是否安装 plist
   - 是否 loaded
   - 当前 pid

2. Pluse metadata
   - `~/.pluse/system/runtime/server.json`
   - 记录端口、pid、启动时间

3. Health check
   - 请求 `http://localhost:{port}/health`
   - 判断服务实际可用性

如果三者不一致，`status` 应显式显示不一致，而不是只给一个布尔值。

## 前端体验

第一期不要求前端自己启动服务，因为浏览器无法启动本机后端。

但前端可以改善断连体验：

- API 请求失败时显示“服务连接中断”
- 提示运行 `pluse service status`
- SSE 断开时进入可恢复状态，而不是只静默失败

这部分可以作为后续 phase，不阻塞服务常驻闭环。

## 分期设计

### Phase 1：本机常驻闭环

- CLI 提供 service 管理命令
- macOS LaunchAgent 安装/卸载/启动/停止/状态
- 日志路径固定
- health check 与 server metadata 合并展示
- README 更新常驻运行方式

### Phase 2：前端离线状态提示

- API/SSE 断连时显示明确状态
- 提供 CLI 恢复建议
- 可选展示上次成功连接时间

### Phase 3：跨平台扩展

- Linux systemd user service
- Windows 启动项或服务方案
- 统一 service provider 抽象

## 依赖与前置

- 需要已有构建产物或在 install/start 前提示执行 `pnpm build`
- 需要稳定 CLI 入口能找到当前仓库和 server dist
- 需要 `server.json` 在服务启动时可靠写入
- 需要日志目录 `~/.pluse/logs/`

## 不在范围内

- 让开发模式也自动保活
- 管理 Codex / Claude 子进程生命周期
- 将 Pluse 部署为系统级 root 服务
- 远程访问和公网暴露
- 自动解决端口冲突

## 验收要点

- 安装后登录启动或手动 start 可拉起服务
- 关闭终端不影响服务继续运行
- 杀掉 server 进程后 supervisor 会自动重启
- `pluse service status --json` 能准确表达运行状态
- `pluse service stop` 后 7760 不再监听
- 日志文件可用于排查启动失败
