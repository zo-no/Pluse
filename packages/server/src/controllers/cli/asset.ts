import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { Command } from 'commander'
import type { UploadedAsset } from '@pluse/types'
import { getOrCreateApiToken, hasAuth } from '../../models/auth'
import { createAsset } from '../../models/asset'
import { getQuest } from '../../models/quest'
import { getAssetsDir } from '../../support/paths'
import { daemonRequest, getCliMode, resolveDaemonBaseUrl } from '../../support/cli-runtime'

function getApiToken(): string {
  return process.env['PLUSE_API_TOKEN']?.trim()
    || (hasAuth() ? getOrCreateApiToken() : '')
}

async function uploadFileToDaemon(baseUrl: string, questId: string, filePath: string): Promise<UploadedAsset> {
  const fileBuffer = readFileSync(filePath)
  const filename = basename(filePath)
  const mimeType = guessMimeType(filename)
  const blob = new Blob([fileBuffer], { type: mimeType })
  const formData = new FormData()
  formData.append('questId', questId)
  formData.append('file', blob, filename)

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

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
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

    if (baseUrl) {
      // Daemon 模式：通过 HTTP 上传
      const fileBuffer = readFileSync(absolutePath)
      const filename = basename(absolutePath)
      const mimeType = guessMimeType(filename)
      const blob = new Blob([fileBuffer], { type: mimeType })
      const formData = new FormData()
      formData.append('questId', opts.questId)
      formData.append('file', blob, filename)

      const token = process.env['PLUSE_API_TOKEN']?.trim()
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch(`${baseUrl}/api/assets/upload`, {
        method: 'POST',
        headers,
        body: formData,
      })
      const json = await res.json() as { ok: boolean; data?: UploadedAsset; error?: string }
      if (!json.ok || !json.data) {
        console.error(`Upload failed: ${json.error ?? 'unknown error'}`)
        process.exit(1)
      }
      asset = json.data
    } else {
      // 离线模式：直接写入数据库（文件保持原路径）
      const quest = getQuest(opts.questId)
      if (!quest) {
        console.error(`Quest not found: ${opts.questId}`)
        process.exit(1)
      }
      const filename = basename(absolutePath)
      const mimeType = guessMimeType(filename)
      const sizeBytes = statSync(absolutePath).size
      // 确保 assets 目录存在（getAssetsDir 会自动创建）
      getAssetsDir(opts.questId)
      asset = createAsset({
        questId: opts.questId,
        filename,
        savedPath: absolutePath,
        mimeType,
        sizeBytes,
      })
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
  .description('上传 Quest 附件（multipart，与 share 等价）')
  .requiredOption('--quest-id <questId>', 'Quest ID')
  .requiredOption('--file <filePath>', '本地文件路径')
  .option('--json', '以 JSON 格式输出')
  .action(async (opts: { questId: string; file: string; json?: boolean }) => {
    // 复用 share 逻辑
    const absolutePath = resolve(opts.file)
    if (!existsSync(absolutePath)) {
      console.error(`File not found: ${absolutePath}`)
      process.exit(1)
    }

    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)

    let asset: UploadedAsset

    if (baseUrl) {
      const fileBuffer = readFileSync(absolutePath)
      const filename = basename(absolutePath)
      const mimeType = guessMimeType(filename)
      const blob = new Blob([fileBuffer], { type: mimeType })
      const formData = new FormData()
      formData.append('questId', opts.questId)
      formData.append('file', blob, filename)

      const token = process.env['PLUSE_API_TOKEN']?.trim()
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch(`${baseUrl}/api/assets/upload`, {
        method: 'POST',
        headers,
        body: formData,
      })
      const json = await res.json() as { ok: boolean; data?: UploadedAsset; error?: string }
      if (!json.ok || !json.data) {
        console.error(`Upload failed: ${json.error ?? 'unknown error'}`)
        process.exit(1)
      }
      asset = json.data
    } else {
      const quest = getQuest(opts.questId)
      if (!quest) {
        console.error(`Quest not found: ${opts.questId}`)
        process.exit(1)
      }
      const filename = basename(absolutePath)
      const mimeType = guessMimeType(filename)
      const sizeBytes = statSync(absolutePath).size
      getAssetsDir(opts.questId)
      asset = createAsset({
        questId: opts.questId,
        filename,
        savedPath: absolutePath,
        mimeType,
        sizeBytes,
      })
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
      const { listAssets } = await import('../../models/asset')
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

    if (baseUrl) {
      const result = await daemonRequest<{ deleted: boolean }>(baseUrl, `/api/assets/${id}`, { method: 'DELETE' })
      if (opts.json) {
        printJson({ ok: true, data: result })
      } else {
        console.log(`Deleted: ${id}`)
      }
    } else {
      console.error('Delete requires the Pluse daemon to be running')
      process.exit(1)
    }
  })

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
