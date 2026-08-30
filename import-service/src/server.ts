import express, { NextFunction, Request, Response } from 'express'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { fetchImage, fetchPage } from './fetcher.js'
import { consumeRelayToken, pruneRelayTokens, relayDraftImages } from './imageRelay.js'
import { parseXiachufang } from './providers/xiachufang.js'
import { parseXiaohongshu } from './providers/xiaohongshu.js'
import { parseSourceUrl } from './security.js'
import { ImportError } from './types.js'

const app = express()
const defaultAllowedOrigins = [
  'http://127.0.0.1:4173',
  'http://localhost:4173',
  'http://127.0.0.1:43179',
  'http://localhost:43179',
  'https://shawn1017.github.io'
]
const allowedOrigins = new Set(
  String(process.env.IMPORT_ALLOWED_ORIGINS || defaultAllowedOrigins.join(','))
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)
)

function isSameOrigin(request: Request, origin: string): boolean {
  try {
    const originUrl = new URL(origin)
    const requestHost = String(request.get('host') || '').split(',')[0].trim()
    return originUrl.host === requestHost
  } catch {
    return false
  }
}

function normalizePublicOrigin(value: string): string | null {
  try {
    const parsed = new URL(value.trim().replace(/\/$/, ''))
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) return null
    return parsed.origin
  } catch {
    return null
  }
}

export function resolveApiBase(request: Request): string {
  const configuredOrigin = normalizePublicOrigin(String(process.env.IMPORT_PUBLIC_ORIGIN || ''))
  if (configuredOrigin) return configuredOrigin

  const vercelHost = String(process.env.VERCEL_URL || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '')
  if (/^[a-z0-9-]+\.vercel\.app$/i.test(vercelHost)) return `https://${vercelHost}`

  const requestHost = String(request.get('host') || '').split(',')[0].trim()
  const requestProto = request.protocol === 'https' ? 'https' : 'http'
  return `${requestProto}://${requestHost}`
}

app.set('trust proxy', 1)
app.disable('x-powered-by')
app.use((request, response, next) => {
  const origin = String(request.headers.origin || '').replace(/\/$/, '')
  if (origin && (allowedOrigins.has(origin) || isSameOrigin(request, origin))) {
    response.setHeader('access-control-allow-origin', origin)
    response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
    response.setHeader('access-control-allow-headers', 'content-type')
    response.setHeader('vary', 'Origin')
  }
  if (request.method === 'OPTIONS') {
    return origin && (allowedOrigins.has(origin) || isSameOrigin(request, origin))
      ? response.status(204).end()
      : response.status(403).json({ success: false, message: 'Origin Not Allowed' })
  }
  return next()
})
app.use(express.json({ limit: '8kb', strict: true }))

const healthHandler = (_request: Request, response: Response) => response.json({
  ok: true,
  service: 'personal-kitchen-import',
  relayStore: process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'memory',
  time: Date.now()
})
app.get('/health', healthHandler)
app.get('/api/health', healthHandler)

app.post('/api/import/recipe', async (request, response) => {
  try {
    const { url, platform } = parseSourceUrl(request.body?.url)
    const page = await fetchPage(url, platform)
    const result = platform === 'xiachufang'
      ? parseXiachufang(page.html, page.finalUrl.toString())
      : parseXiaohongshu(page.html, page.finalUrl.toString())
    const apiBase = resolveApiBase(request)
    await pruneRelayTokens()
    let draft = result.draft
    try {
      draft = await relayDraftImages(result.draft, apiBase)
    } catch {
      result.warnings.push('图片中转暂时不可用，已保留原始图片地址，可稍后手动补图。')
    }
    response.json({ success: true, data: draft, warnings: result.warnings })
  } catch (error) {
    const failure = error instanceof ImportError ? error : new ImportError('PARSE_FAILED', '解析过程中发生未知错误')
    const status = failure.code === 'INVALID_URL' || failure.code === 'UNSUPPORTED_SOURCE' ? 400 : 422
    response.status(status).json({ success: false, errorCode: failure.code, message: failure.message, partialData: failure.partialData || {} })
  }
})

app.get('/api/import/image/:token', async (request, response) => {
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('content-security-policy', "sandbox; default-src 'none'")
  response.setHeader('referrer-policy', 'no-referrer')
  const sourceUrl = await consumeRelayToken(String(request.params.token || ''))
  if (!sourceUrl) return response.status(404).json({ success: false, message: '图片链接已失效，请重新导入' })
  try {
    const image = await fetchImage(new URL(sourceUrl))
    response.setHeader('content-type', image.contentType)
    response.setHeader('cache-control', 'private, max-age=300')
    response.setHeader('content-length', image.bytes.byteLength)
    return response.send(Buffer.from(image.bytes))
  } catch {
    return response.status(422).json({ success: false, message: '图片读取失败，可稍后手动补图' })
  }
})

app.use((_request, response) => response.status(404).json({ success: false, message: 'Not Found' }))
app.use((error: Error, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof SyntaxError) return response.status(400).json({ success: false, errorCode: 'INVALID_URL', message: '请求 JSON 格式不正确' })
  return response.status(500).json({ success: false, errorCode: 'PARSE_FAILED', message: '服务内部错误' })
})

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  const port = Number(process.env.PORT || 3210)
  const server = app.listen(port, '0.0.0.0', () => console.log(`[personal-kitchen-import] listening on ${port}`))
  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
}

export default app
