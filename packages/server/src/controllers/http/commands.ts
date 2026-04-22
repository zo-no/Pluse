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
  modules: CommandModule[]
}

export function getCommandCatalog(): CommandCatalog {
  return {
    modules: [
      {
        name: 'quest',
        description: 'Quest 管理（Session / Task 统一入口）',
        commands: [
          {
            name: 'quest list',
            cli: 'pluse quest list --project-id <id> [--kind session|task] [--search <query>] [--json]',
            api: 'GET /api/quests?projectId=<id>',
            description: '列出项目下的 Quest',
          },
          {
            name: 'quest get',
            cli: 'pluse quest get <id> [--json]',
            api: 'GET /api/quests/<id>',
            description: '获取 Quest 详情',
          },
          {
            name: 'quest create',
            cli: 'pluse quest create --project-id <id> --kind session|task [task flags: --schedule-kind/--executor-kind/--prompt/--command/--review-on-complete/--order] [--json]',
            api: 'POST /api/quests',
            description: '创建新的 Quest；task 可一次设置 schedule、executor 和 review 选项',
          },
          {
            name: 'quest update',
            cli: 'pluse quest update <id> [--kind session|task] [task flags: --schedule-kind/--executor-kind/--prompt/--command/--review-on-complete/--order] [--json]',
            api: 'PATCH /api/quests/<id>',
            description: '更新 Quest；task 复用与 create 相同的调度和执行器参数',
          },
          {
            name: 'quest move',
            cli: 'pluse quest move <id> --to-project-id <id> [--json]',
            api: 'POST /api/quests/:id/move',
            description: '把 Quest 移动到其他项目',
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
            cli: 'pluse todo list --project-id <id> [--status pending|done] [--json]',
            api: 'GET /api/todos?projectId=<id>',
            description: '列出项目下所有 Todo',
          },
          {
            name: 'todo get',
            cli: 'pluse todo get <id> [--json]',
            api: 'GET /api/todos/<id>',
            description: '获取 Todo 详情',
          },
          {
            name: 'todo create',
            cli: 'pluse todo create --project-id <id> --title <title> [--json]',
            api: 'POST /api/todos',
            description: '创建新的 Todo',
          },
          {
            name: 'todo done',
            cli: 'pluse todo done <id> [--json]',
            api: 'PATCH /api/todos/:id',
            description: '将 Todo 标记为完成',
          },
          {
            name: 'todo update',
            cli: 'pluse todo update <id> [--status pending|done] [--json]',
            api: 'PATCH /api/todos/:id',
            description: '更新 Todo 内容或状态',
          },
          {
            name: 'todo delete',
            cli: 'pluse todo delete <id> --confirm',
            api: 'DELETE /api/todos/:id',
            description: '归档 Todo',
          },
        ],
      },
      {
        name: 'run',
        description: '执行记录',
        commands: [
          {
            name: 'run list',
            cli: 'pluse run list <questId> [--json]',
            api: 'GET /api/quests/<id>/runs',
            description: '查看 Quest 的运行历史',
          },
          {
            name: 'run cancel',
            cli: 'pluse run cancel <id>',
            api: 'POST /api/runs/<id>/cancel',
            description: '取消正在运行的 Run',
          },
        ],
      },
      {
        name: 'project',
        description: '项目管理',
        commands: [
          {
            name: 'project list',
            cli: 'pluse project list [--json]',
            api: 'GET /api/projects',
            description: '列出所有项目',
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
            description: '查看项目概览',
          },
          {
            name: 'project open',
            cli: 'pluse project open --work-dir <path> [--name <name>] [--goal <goal>] [--description <text>] [--system-prompt <prompt>] [--domain-id <id>] [--pin] [--json]',
            api: 'POST /api/projects/open',
            description: '打开或创建项目',
          },
          {
            name: 'project update',
            cli: 'pluse project update <id> [--name <name>] [--goal <goal>] [--description <text>] [--clear-description] [--system-prompt <prompt>] [--domain-id <id>] [--clear-domain] [--pin] [--unpin] [--archive] [--json]',
            api: 'PATCH /api/projects/<id>',
            description: '更新项目属性',
          },
          {
            name: 'project archive',
            cli: 'pluse project archive <id> [--json]',
            api: 'POST /api/projects/<id>/archive',
            description: '归档项目',
          },
          {
            name: 'project delete',
            cli: 'pluse project delete <id> --confirm [--json]',
            api: 'DELETE /api/projects/<id>',
            description: '归档项目及其数据',
          },
        ],
      },
      {
        name: 'domain',
        description: 'Domain 管理',
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
            description: '创建默认 Domain 模板（自动跳过重复项）',
          },
          {
            name: 'domain create',
            cli: 'pluse domain create --name <name> [--description <text>] [--icon <icon>] [--color <color>] [--order-index <n>] [--json]',
            api: 'POST /api/domains',
            description: '创建新的 Domain',
          },
          {
            name: 'domain update',
            cli: 'pluse domain update <id> [--name <name>] [--description <text>] [--icon <icon>] [--color <color>] [--order-index <n>] [--json]',
            api: 'PATCH /api/domains/<id>',
            description: '更新 Domain 内容',
          },
          {
            name: 'domain delete',
            cli: 'pluse domain delete <id> --confirm [--json]',
            api: 'DELETE /api/domains/<id>',
            description: '归档 Domain，并将其下项目移回未分组',
          },
        ],
      },
      {
        name: 'session-category',
        description: 'Session 分类',
        commands: [
          {
            name: 'session-category list',
            cli: 'pluse session-category list --project-id <id> [--json]',
            api: 'GET /api/projects/<id>/session-categories',
            description: '列出项目下的会话分类',
          },
          {
            name: 'session-category create',
            cli: 'pluse session-category create --project-id <id> --name <name> [--description <text>] [--collapsed true|false] [--json]',
            api: 'POST /api/projects/<id>/session-categories',
            description: '创建会话分类',
          },
          {
            name: 'session-category update',
            cli: 'pluse session-category update <id> [--name <name>] [--description <text>] [--collapsed true|false] [--json]',
            api: 'PATCH /api/session-categories/<id>',
            description: '更新会话分类',
          },
          {
            name: 'session-category delete',
            cli: 'pluse session-category delete <id> --confirm [--json]',
            api: 'DELETE /api/session-categories/<id>',
            description: '删除会话分类并解绑其下会话',
          },
        ],
      },
      {
        name: 'commands',
        description: '系统',
        commands: [
          {
            name: 'commands',
            cli: 'pluse commands [--json]',
            api: 'GET /api/commands',
            description: '列出所有可用命令',
          },
        ],
      },
    ],
  }
}

export const commandsRouter = new Hono()

commandsRouter.get('/commands', (c) => {
  return c.json({ ok: true, data: getCommandCatalog() } as ApiResult<CommandCatalog>)
})
