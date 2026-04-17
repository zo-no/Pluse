import { Hono } from 'hono'
import type { ApiResult } from '@melody-sync/types'

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
        name: 'session',
        description: '会话管理',
        commands: [
          {
            name: 'session list',
            cli: 'pulse session list --project <id> [--json]',
            api: 'GET /api/sessions?projectId=<id>',
            description: '列出项目下所有会话',
          },
          {
            name: 'session get',
            cli: 'pulse session get <id> [--json]',
            api: 'GET /api/sessions/<id>',
            description: '获取会话详情',
          },
          {
            name: 'session create',
            cli: 'pulse session create --project <id> --name <name> [--json]',
            api: 'POST /api/sessions',
            description: '创建新会话',
          },
          {
            name: 'session create-task',
            cli: 'pulse session create-task <sessionId> --title <title> --assignee ai|human [--json]',
            api: 'POST /api/sessions/:id/create-task',
            description: '将会话转为任务，复用该会话作为执行上下文',
          },
        ],
      },
      {
        name: 'task',
        description: '任务管理',
        commands: [
          {
            name: 'task list',
            cli: 'pulse task list --project <id> [--status pending|running|done] [--assignee ai|human] [--json]',
            api: 'GET /api/tasks?projectId=<id>',
            description: '列出项目下所有任务',
          },
          {
            name: 'task get',
            cli: 'pulse task get <id> [--json]',
            api: 'GET /api/tasks/<id>',
            description: '获取任务详情',
          },
          {
            name: 'task create',
            cli: 'pulse task create --project <id> --title <title> --assignee ai|human [--json]',
            api: 'POST /api/tasks',
            description: '创建新任务',
          },
          {
            name: 'task done',
            cli: 'pulse task done <id> --output <summary> [--json]',
            api: 'POST /api/tasks/<id>/done',
            description: '标记任务完成并记录输出',
          },
          {
            name: 'task run',
            cli: 'pulse task run <id> [--json]',
            api: 'POST /api/tasks/<id>/run',
            description: '立即触发执行一个 AI Task',
          },
          {
            name: 'task block',
            cli: 'pulse task block <id> --by <blockerId> [--json]',
            api: 'POST /api/tasks/<id>/block',
            description: '设置任务依赖，当前任务等待 blockerId 完成后才能执行',
          },
          {
            name: 'task unblock',
            cli: 'pulse task unblock <id> [--json]',
            api: 'DELETE /api/tasks/<id>/block',
            description: '移除任务的依赖关系',
          },
          {
            name: 'task create-session',
            cli: 'pulse task create-session <taskId> [--name <name>] [--json]',
            api: 'POST /api/tasks/<id>/create-session',
            description: '为任务创建对话会话',
          },
          {
            name: 'task cancel',
            cli: 'pulse task cancel <id> [--json]',
            api: 'POST /api/tasks/<id>/cancel',
            description: '取消任务执行',
          },
        ],
      },
      {
        name: 'project',
        description: '项目管理',
        commands: [
          {
            name: 'project list',
            cli: 'pulse project list [--json]',
            api: 'GET /api/projects',
            description: '列出所有项目',
          },
          {
            name: 'project get',
            cli: 'pulse project get <id> [--json]',
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
            cli: 'pulse commands [--json]',
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
