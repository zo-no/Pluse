import { existsSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { Command } from 'commander'
import type { UploadedAsset } from '@pluse/types'
import { getOrCreateApiToken, hasAuth } from '../../models/auth'
import { createAsset, listAssets } from '../../models/asset'
import { getQuest } from '../../models/quest'
import { getAssetsDir } from '../../support/paths'
import { daemonRequest, getCliMode, resolveDaemonBaseUrl } from '../../support/cli-runtime'

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function getApiToken(): string {
  return process.env['PLUSE_API_TOKEN']?.trim()
    || (hasAuth() ? getOrCreateApiToken() : '')
}

function guessMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
  }
  return map[ext] ?? 'application/octet-stream'
}

async function uploadFileToDaemon(baseUrl: string, questId: string, absolutePath: string): Promise<UploadedAsset> {
  const file = Bun.file(absolutePath)
  const filename = basename(absolutePath)
  const mimeType = guessMimeType(filename)
  const formData = new FormData()
  formData.append('questId', questId)
  formData.append('file', new Blob([await file.arrayBuffer()], { type: mimeType }), filename)

  const token = getApiToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${baseUrl}/api/assets/upload`, {
    method: 'POST',
    headers,
    body: formData,
  })
  const json = await res.json() as { ok: boolean; data?: UploadedAsset; error?: string }
  if (!json.ok || !json.data) {
    throw new Error(json.error ?? 'unknown error')
  }
  return json.data
}

function shareOffline(questId: string, absolutePath: string): UploadedAsset {
  const quest = getQuest(questId)
  if (!quest) throw new Error(`Quest not found: ${questId}`)
  const filename = basename(absolutePath)
  const mimeType = guessMimeType(filename)
  const sizeBytes = statSync(absolutePath).size
  getAssetsDir(questId) // 确保目录存在
  return createAsset({ questId, filename, savedPath: absolutePath, mimeType, sizeBytes })
}

export const assetCommand = new Command('asset')
assetCommand.description('Quest 附件管理')

// asset share <filePath> --quest-id <id>
// 将本地文件注册为附件，输出 [pluse-asset:<id>] 标记供 AI 嵌入消息
assetCommand
  .command('share <filePath>')
  .description('将本地文件注册为 Quest 附件，输出 [pluse-asset:<id>] 标记')
  .requiredOption('--quest-id <questId>', 'Quest ID')
  .option('--json', '以 JSON 格式输出')
  .action(async (filePath: string, opts: { questId: string; json?: boolean }) => {
    const absolutePath = resolve(filePath)
    if (!existsSync(absolutePath)) {
      console.error(`File not found: ${absolutePath}`)
      process.exit(1)
    }
    if (!statSync(absolutePath).isFile()) {
      console.error(`Not a file: ${absolutePath}`)
      process.exit(1)
    }

    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)

    let asset: UploadedAsset
    try {
      asset = baseUrl
        ? await uploadFileToDaemon(baseUrl, opts.questId, absolutePath)
        : shareOffline(opts.questId, absolutePath)
    } catch (err) {
      console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }

    if (opts.json) {
      printJson({ ok: true, data: asset, marker: `[pluse-asset:${asset.id}]` })
    } else {
      console.log(`[pluse-asset:${asset.id}]`)
    }
  })

// asset upload --quest-id <id> --file <path>
assetCommand
  .command('upload')
  .description('上传 Quest 附件（与 share 等价）')
  .requiredOption('--quest-id <questId>', 'Quest ID')
  .requiredOption('--file <filePath>', '本地文件路径')
  .option('--json', '以 JSON 格式输出')
  .action(async (opts: { questId: string; file: string; json?: boolean }) => {
    const absolutePath = resolve(opts.file)
    if (!existsSync(absolutePath)) {
      console.error(`File not found: ${absolutePath}`)
      process.exit(1)
    }

    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)

    let asset: UploadedAsset
    try {
      asset = baseUrl
        ? await uploadFileToDaemon(baseUrl, opts.questId, absolutePath)
        : shareOffline(opts.questId, absolutePath)
    } catch (err) {
      console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }

    if (opts.json) {
      printJson({ ok: true, data: asset })
    } else {
      console.log(`${asset.id}  ${asset.filename}  ${asset.savedPath}`)
    }
  })

// asset list --quest-id <id>
assetCommand
  .command('list')
  .description('列出 Quest 附件')
  .requiredOption('--quest-id <questId>', 'Quest ID')
  .option('--json', '以 JSON 格式输出')
  .action(async (opts: { questId: string; json?: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)

    let assets: UploadedAsset[]
    if (baseUrl) {
      assets = await daemonRequest<UploadedAsset[]>(baseUrl, `/api/assets?questId=${opts.questId}`)
    } else {
      assets = listAssets(opts.questId)
    }

    if (opts.json) {
      printJson(assets)
    } else {
      for (const a of assets) {
        console.log(`${a.id}  ${a.filename}  ${a.mimeType}  ${a.savedPath}`)
      }
    }
  })

// asset delete <id> --confirm
assetCommand
  .command('delete <id>')
  .description('删除 Quest 附件')
  .option('--confirm', '确认删除')
  .option('--json', '以 JSON 格式输出')
  .action(async (id: string, opts: { confirm?: boolean; json?: boolean }) => {
    if (!opts.confirm) {
      console.error('Use --confirm to delete an asset')
      process.exit(1)
    }

    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)

    if (!baseUrl) {
      console.error('Delete requires the Pluse daemon to be running')
      process.exit(1)
    }

    const result = await daemonRequest<{ deleted: boolean }>(baseUrl, `/api/assets/${id}`, { method: 'DELETE' })
    if (opts.json) {
      printJson({ ok: true, data: result })
    } else {
      console.log(`Deleted: ${id}`)
    }
  })
