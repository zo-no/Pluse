import { Hono } from 'hono'
import type { ApiResult } from '@pluse/types'

export interface CommandEntry {
  name: string
  cli: string
  api: string
  description: string
}

export interface CommandModule {
  name: string
  description: string
  commands: CommandEntry[]
}

export interface CommandCatalog {
  version: number
  modules: CommandModule[]
}

function moduleCatalog(): CommandCatalog['modules'] {
  return [
    {
      name: 'quest',
      description: 'Quest 统一入口，覆盖 Session / Task 两类工作对象',
      commands: [
        {
          name: 'quest list',
          cli: 'pluse quest list [--project-id <id>] [--kind session|task] [--status pending|running|done|cancelled] [--json]',
          api: 'GET /api/quests',
          description: '列出 Quest（会话 / 任务）',
        },
        {
          name: 'quest get',
          cli: 'pluse quest get <id> [--json]',
          api: 'GET /api/quests/<id>',
          description: '获取 Quest 详情',
        },
        {
          name: 'quest create',
          cli: 'pluse quest create --project-id <id> --kind session|task [--name <text>] [--title <text>] [--schedule-kind none|once|scheduled|recurring] [--schedule-config <json>] [--executor-kind ai_prompt|checklist] [--executor-config <json>] [--json]',
          api: 'POST /api/quests',
          description: '创建新的 Quest',
        },
        {
          name: 'quest update',
          cli: 'pluse quest update <id> [--name <text>] [--title <text>] [--status pending|running|done|cancelled] [--kind session|task] [--json]',
          api: 'PATCH /api/quests/<id>',
          description: '更新 Quest 基本信息或状态',
        },
        {
          name: 'quest move',
          cli: 'pluse quest move <id> --project-id <targetProjectId> [--json]',
          api: 'PATCH /api/quests/<id>',
          description: '将 Quest 移动到另一个项目',
        },
        {
          name: 'quest message',
          cli: 'pluse quest message <id> --text <text> [--json]',
          api: 'POST /api/quests/:id/messages',
          description: '向会话 Quest 发送消息',
        },
        {
          name: 'quest run',
          cli: 'pluse quest run <id> [--json]',
          api: 'POST /api/quests/:id/run',
          description: '手动触发任务 Quest',
        },
      ],
    },
    {
      name: 'todo',
      description: 'Todo 管理',
      commands: [
        {
          name: 'todo list',
          cli: 'pluse todo list [--project-id <id> | --quest-id <id>] [--status pending|doing|done|cancelled] [--json]',
          api: 'GET /api/todos?projectId=<id> | GET /api/quests/<id>/progress',
          description: '列出项目 Todo；传 --quest-id 时返回该 Quest 的 Progress 条目',
        },
        {
          name: 'todo get',
          cli: 'pluse todo get <id> [--json]',
          api: 'GET /api/todos/<id>',
          description: '获取 Todo 详情',
        },
        {
          name: 'todo create',
          cli: 'pluse todo create --project-id <id> --title <title> [--due-at <ISO time>] [--waiting <text>] [--priority urgent|high|normal|low] [--json]',
          api: 'POST /api/todos',
          description: '创建新的 Todo；只有存在截止时间、执行窗口或复核时间时才填写 --due-at',
        },
        {
          name: 'todo done',
          cli: 'pluse todo done <id> [--json]',
          api: 'PATCH /api/todos/:id',
          description: '将 Todo 标记为完成',
        },
        {
          name: 'todo update',
          cli: 'pluse todo update <id> [--status pending|done] [--due-at <ISO time>|--clear-due] [--json]',
          api: 'PATCH /api/todos/:id',
          description: '更新 Todo 内容或状态',
        },
        {
          name: 'todo delete',
          cli: 'pluse todo delete <id> --confirm',
          api: 'DELETE /api/todos/:id',
          description: '归档 Todo',
        },
        {
          name: 'todo progress-create',
          cli: 'pluse todo progress-create --quest-id <id> [--project-id <id>] --title <title> [--active-form <text>] [--waiting <text>] [--for ai|human] [--json]',
          api: 'POST /api/todos',
          description: '创建 Quest Progress 条目；AI 步骤与等待人类处理事项都通过它写入',
        },
        {
          name: 'todo progress-update',
          cli: 'pluse todo progress-update <id> [--status pending|doing|done|cancelled] [--title <title>] [--active-form <text>] [--json]',
          api: 'PATCH /api/todos/:id',
          description: '更新 Progress 条目的状态或显示文案',
        },
        {
          name: 'todo progress-wait',
          cli: 'pluse todo progress-wait <id> [--timeout <seconds>] [--interval <ms>]',
          api: 'GET /api/todos/<id> (poll)',
          description: '阻塞等待指定 Progress 条目被标记完成或取消',
        },
      ],
    },
    {
      name: 'reminder',
      description: '提醒管理',
      commands: [
        {
          name: 'reminder list',
          cli: 'pluse reminder list [--project-id <id>] [--order attention|time] [--type review|custom|follow_up|needs_input|failure] [--json]',
          api: 'GET /api/reminders',
          description: '列出全局提醒流；可选按项目过滤',
        },
        {
          name: 'reminder get',
          cli: 'pluse reminder get <id> [--json]',
          api: 'GET /api/reminders/<id>',
          description: '获取提醒详情',
        },
        {
          name: 'reminder update',
          cli: 'pluse reminder update <id> [--remind-at <time>] [--json]',
          api: 'PATCH /api/reminders/:id',
          description: '更新提醒内容或时间',
        },
        {
          name: 'reminder snooze',
          cli: 'pluse reminder snooze <id> --until <time> [--json]',
          api: 'PATCH /api/reminders/:id',
          description: '稍后提醒',
        },
        {
          name: 'reminder delete',
          cli: 'pluse reminder delete <id> --confirm [--json]',
          api: 'DELETE /api/reminders/:id',
          description: '删除提醒',
        },
      ],
    },
    {
      name: 'check-in',
      description: '打卡管理',
      commands: [
        {
          name: 'check-in list',
          cli: 'pluse check-in list --project-id <id> [--json]',
          api: 'GET /api/check-ins?projectId=<id>',
          description: '列出当前待用户回执的打卡项',
        },
        {
          name: 'check-in create',
          cli: 'pluse check-in create --project-id <id> --title <title> [--remind-at <time>] [--json]',
          api: 'POST /api/check-ins',
          description: '创建新的打卡项',
        },
        {
          name: 'check-in complete',
          cli: 'pluse check-in complete <id> [--note <text>] [--json]',
          api: 'POST /api/check-ins/:id/complete',
          description: '完成打卡并写入回执记录',
        },
        {
          name: 'check-in records',
          cli: 'pluse check-in records [--project-id <id>] [--json]',
          api: 'GET /api/check-in-records?projectId=<id>',
          description: '查看历史打卡记录',
        },
      ],
    },
    {
      name: 'run',
      description: 'Quest Run 执行记录',
      commands: [
        {
          name: 'run list',
          cli: 'pluse run list --quest-id <id> [--json]',
          api: 'GET /api/quests/<id>/runs',
          description: '列出 Quest 的执行记录',
        },
        {
          name: 'run get',
          cli: 'pluse run get <id> [--json]',
          api: 'GET /api/runs/<id>',
          description: '获取 Run 详情',
        },
        {
          name: 'run cancel',
          cli: 'pluse run cancel <id> [--json]',
          api: 'POST /api/runs/<id>/cancel',
          description: '请求取消正在运行的 Run',
        },
      ],
    },
    {
      name: 'project',
      description: '项目容器管理',
      commands: [
        {
          name: 'project list',
          cli: 'pluse project list [--all] [--json]',
          api: 'GET /api/projects',
          description: '列出项目',
        },
        {
          name: 'project get',
          cli: 'pluse project get <id> [--json]',
          api: 'GET /api/projects/<id>',
          description: '获取项目详情',
        },
        {
          name: 'project overview',
          cli: 'pluse project overview <id> [--json]',
          api: 'GET /api/projects/<id>/overview',
          description: '查看项目总览（Quest/Todo/最近运行）',
        },
        {
          name: 'project open',
          cli: 'pluse project open --work-dir <path> [--name <name>] [--goal <text>] [--domain-id <id>] [--pin] [--json]',
          api: 'POST /api/projects/open',
          description: '注册或打开一个本地项目目录',
        },
        {
          name: 'project update',
          cli: 'pluse project update <id> [--name <name>] [--goal <text>] [--domain-id <id>|--clear-domain] [--json]',
          api: 'PATCH /api/projects/<id>',
          description: '更新项目信息',
        },
        {
          name: 'project archive',
          cli: 'pluse project archive <id> [--json]',
          api: 'PATCH /api/projects/<id>',
          description: '归档项目',
        },
        {
          name: 'project delete',
          cli: 'pluse project delete <id> --confirm [--json]',
          api: 'DELETE /api/projects/<id>',
          description: '删除项目及其 manifest 记录',
        },
      ],
    },
    {
      name: 'domain',
      description: '项目分组管理',
      commands: [
        {
          name: 'domain list',
          cli: 'pluse domain list [--with-projects] [--json]',
          api: 'GET /api/domains',
          description: '列出所有 Domain',
        },
        {
          name: 'domain defaults',
          cli: 'pluse domain defaults [--json]',
          api: 'POST /api/domains/defaults',
          description: '初始化默认领域分组',
        },
        {
          name: 'domain create',
          cli: 'pluse domain create --name <name> [--description <text>] [--json]',
          api: 'POST /api/domains',
          description: '创建 Domain',
        },
        {
          name: 'domain update',
          cli: 'pluse domain update <id> [--name <name>] [--description <text>] [--json]',
          api: 'PATCH /api/domains/<id>',
          description: '更新 Domain',
        },
        {
          name: 'domain delete',
          cli: 'pluse domain delete <id> --confirm [--json]',
          api: 'DELETE /api/domains/<id>',
          description: '删除 Domain（会将其项目移回未分组）',
        },
      ],
    },
    {
      name: 'session-category',
      description: 'Session 分类管理',
      commands: [
        {
          name: 'session-category list',
          cli: 'pluse session-category list --project-id <id> [--json]',
          api: 'GET /api/projects/<id>/session-categories',
          description: '列出项目的会话分类',
        },
        {
          name: 'session-category create',
          cli: 'pluse session-category create --project-id <id> --name <name> [--description <text>] [--json]',
          api: 'POST /api/projects/<id>/session-categories',
          description: '创建会话分类',
        },
        {
          name: 'session-category update',
          cli: 'pluse session-category update <id> [--name <name>] [--description <text>] [--json]',
          api: 'PATCH /api/session-categories/<id>',
          description: '更新会话分类',
        },
        {
          name: 'session-category delete',
          cli: 'pluse session-category delete <id> --confirm [--json]',
          api: 'DELETE /api/session-categories/<id>',
          description: '删除会话分类',
        },
      ],
    },
    {
      name: 'asset',
      description: 'Quest 附件管理',
      commands: [
        {
          name: 'asset upload',
          cli: 'pluse asset upload --quest-id <id> --file <path> [--json]',
          api: 'POST /api/assets',
          description: '上传 Quest 附件',
        },
        {
          name: 'asset list',
          cli: 'pluse asset list --quest-id <id> [--json]',
          api: 'GET /api/assets?questId=<id>',
          description: '列出 Quest 附件',
        },
        {
          name: 'asset delete',
          cli: 'pluse asset delete <id> --confirm [--json]',
          api: 'DELETE /api/assets/<id>',
          description: '删除 Quest 附件',
        },
      ],
    },
    {
      name: 'commands',
      description: '命令总览',
      commands: [
        {
          name: 'commands list',
          cli: 'pluse commands [--json]',
          api: 'GET /api/commands',
          description: '获取系统支持的 CLI / HTTP 命令清单',
        },
      ],
    },
  ]
}

export function getCommandCatalog(): CommandCatalog {
  return {
    version: 1,
    modules: moduleCatalog(),
  }
}

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

export const commandsRouter = new Hono()
commandsRouter.get('/commands', (c) => c.json(ok(getCommandCatalog())))
