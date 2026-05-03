# 0013 — CLI Catalog Command MVP

**状态**: accepted
**类型**: spec
**关联 requirement**: `docs/v2/requirements/0013-cli-catalog-command.md`
**关联 design**: `docs/v2/designs/0013-cli-catalog-command.md`

## Summary

本期实现全局 CLI 集合查询命令：用户在全局设置页设置一条命令行，Pluse 将它注入 Quest system prompt，供 Agent 查询当前环境所有外部 CLI / 指令。

## Data / Types

- 扩展 `AppSettings.cliCatalogCommand: string`。
- 扩展 `UpdateAppSettingsInput.cliCatalogCommand?: string | null`。
- 使用 settings key `cli_catalog_command` 保存 trim 后的字符串。
- 空字符串表示未配置。
- 不新增数据库表。

## API

- `GET /api/settings`
  - 默认返回 `cliCatalogCommand: ""`。
- `PATCH /api/settings`
  - 支持写入 `cliCatalogCommand`。
  - trim 后保存。
  - `null` 或空白字符串清空设置。
  - 不验证命令是否存在。

## UI

全局 `SettingsPage` 新增「CLI 集合」区块：

- 一个输入框填写查询命令。
- 保存使用现有全局保存按钮。
- 不提供逐条 CLI 的列表、启停、用途或示例字段。

## Prompt

- `buildSessionSystemPrompt` 和 `buildTaskSystemPrompt` 注入同一个 CLI catalog block。
- 配置为空时不注入。
- 配置存在时提示 Agent 运行该命令查看所有可用外部 CLI 指令。
- prompt 明确说明 Pluse 未执行校验，也不会代为执行。

## Acceptance

- 默认 settings 返回空 `cliCatalogCommand`。
- PATCH 后能读取 trim 后的保存结果。
- `null` 可清空命令。
- 配置存在时，session/task prompt 包含该命令。
- 配置为空时，prompt 不包含 CLI catalog block。
- Web 和 server typecheck 通过。

## 不做

- Project 级覆盖
- PATH 扫描
- CLI 安装、版本检测或执行
- 权限模型、参数白名单或执行面板
- 逐条 CLI 注册表
- 与 custom runtime tools 合并
