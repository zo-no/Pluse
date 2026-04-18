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
        description: 'Quest / 会话 / 任务管理',
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
            cli: 'pluse quest create --project-id <id> --kind session|task [--json]',
            api: 'POST /api/quests',
            description: '创建新的会话态或任务态 Quest',
          },
          {
            name: 'quest message',
            cli: 'pluse quest message <id> --text <text> [--json]',
            api: 'POST /api/quests/:id/messages',
            description: '向 session 态 Quest 发送消息',
          },
          {
            name: 'quest run',
            cli: 'pluse quest run <id> [--json]',
            api: 'POST /api/quests/:id/run',
            description: '手动触发 task 态 Quest',
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
            description: '删除 Todo',
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
