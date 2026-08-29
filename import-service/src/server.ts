import express, { NextFunction, Request, Response } from 'express'
import { fetchImage, fetchPage } from './fetcher.js'
import { consumeRelayToken, pruneRelayTokens, relayDraftImages } from './imageRelay.js'
import { parseXiachufang } from './providers/xiachufang.js'
import { parseXiaohongshu } from './providers/xiaohongshu.js'
import { parseSourceUrl } from './security.js'
import { ImportError } from './types.js'

const app = express()
app.set('trust proxy', 1)
app.disable('x-powered-by')
app.use(express.json({ limit: '8kb', strict: true }))

app.get('/health', (_request, response) => response.json({ ok: true, service: 'personal-kitchen-import', time: Date.now() }))

app.post('/api/import/recipe', async (request, response) => {
  try {
    const { url, platform } = parseSourceUrl(request.body?.url)
    const page = await fetchPage(url, platform)
    const result = platform === 'xiachufang'
      ? parseXiachufang(page.html, page.finalUrl.toString())
      : parseXiaohongshu(page.html, page.finalUrl.toString())
    const requestedProto = String(request.headers['x-forwarded-proto'] || request.protocol).split(',')[0].trim()
    const forwardedProto = requestedProto === 'https' ? 'https' : 'http'
    const apiBase = `${forwardedProto}://${request.get('host')}`
    pruneRelayTokens()
    response.json({ success: true, data: relayDraftImages(result.draft, apiBase), warnings: result.warnings })
  } catch (error) {
    const failure = error instanceof ImportError ? error : new ImportError('PARSE_FAILED', '解析过程中发生未知错误')
    const status = failure.code === 'INVALID_URL' || failure.code === 'UNSUPPORTED_SOURCE' ? 400 : 422
    response.status(status).json({ success: false, errorCode: failure.code, message: failure.message, partialData: failure.partialData || {} })
  }
})

app.get('/api/import/image/:token', async (request, response) => {
  const sourceUrl = consumeRelayToken(String(request.params.token || ''))
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

const port = Number(process.env.PORT || 3210)
const server = app.listen(port, '0.0.0.0', () => console.log(`[personal-kitchen-import] listening on ${port}`))
server.requestTimeout = 15_000
server.headersTimeout = 10_000
