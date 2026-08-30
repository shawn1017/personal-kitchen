const MAX_JSON_BYTES = 8 * 1024
const MAX_JSON_RESPONSE_BYTES = 4 * 1024 * 1024
const MAX_HEALTH_BYTES = 32 * 1024
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const UPSTREAM_TIMEOUT_MS = 13_000
const IMAGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/
const SAFE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])

export interface GatewayConfig {
  upstreamOrigin: string
  bypassSecret: string
  accessKey: string
  allowedOrigin: string
  upstreamTimeoutMs?: number
}

export type GatewayFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function jsonResponse(status: number, body: unknown, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      ...Object.fromEntries(new Headers(extraHeaders))
    }
  })
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-kitchen-access',
    'access-control-max-age': '600',
    'vary': 'Origin'
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder()
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  let mismatch = leftBytes.length ^ rightBytes.length
  const length = Math.max(leftBytes.length, rightBytes.length)
  for (let index = 0; index < length; index += 1) mismatch |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0)
  return mismatch === 0
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, '')
}

function normalizeUpstreamOrigin(value: string): string {
  const parsed = new URL(value.trim())
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname.toLowerCase().endsWith('.vercel.app')
  ) {
    throw new Error('Gateway upstream must be a Vercel HTTPS origin')
  }
  return parsed.origin
}

function gatewayBaseFromRequest(url: URL): string {
  const markerIndex = url.pathname.indexOf('/api/')
  const functionPath = markerIndex >= 0 ? url.pathname.slice(0, markerIndex) : url.pathname.replace(/\/$/, '')
  const isSupabaseHost = url.hostname.toLowerCase().endsWith('.supabase.co')
  const publicOrigin = isSupabaseHost ? `https://${url.host}` : url.origin
  if (isSupabaseHost && /^\/[^/]+$/.test(functionPath)) {
    return `${publicOrigin}/functions/v1${functionPath}`
  }
  return `${publicOrigin}${functionPath}`
}

function rewriteRelayUrls(value: unknown, upstreamOrigin: string, gatewayBase: string): unknown {
  if (typeof value === 'string') {
    try {
      const parsed = new URL(value)
      const gatewayHost = new URL(gatewayBase).hostname
      const relayMatch = parsed.pathname.match(/\/api\/import\/image\/([A-Za-z0-9_-]{32})$/)
      const isKnownRelayOrigin = parsed.origin === upstreamOrigin || parsed.hostname === gatewayHost
      if (
        relayMatch &&
        isKnownRelayOrigin &&
        !parsed.username &&
        !parsed.password &&
        !parsed.search &&
        !parsed.hash
      ) {
        return `${gatewayBase}/api/import/image/${relayMatch[1]}`
      }
    } catch {
      return value
    }
    return value
  }
  if (Array.isArray(value)) return value.map((entry) => rewriteRelayUrls(entry, upstreamOrigin, gatewayBase))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewriteRelayUrls(entry, upstreamOrigin, gatewayBase)]))
  }
  return value
}

class BodyLimitError extends Error {
  constructor(readonly scope: 'request' | 'recipe-response' | 'health-response' | 'image-response') {
    super(`Body limit exceeded: ${scope}`)
    this.name = 'BodyLimitError'
  }
}

function declaredBodyBytes(headers: Headers): number {
  const value = Number(headers.get('content-length') || 0)
  return Number.isFinite(value) && value > 0 ? value : 0
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

async function readBodyWithLimit(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  scope: BodyLimitError['scope'],
  onLimit?: () => void,
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (!body) return new Uint8Array()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  let abortHandler: (() => void) | undefined
  const abortPromise = signal && new Promise<never>((_resolve, reject) => {
    abortHandler = () => reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
    if (signal.aborted) abortHandler()
    else signal.addEventListener('abort', abortHandler, { once: true })
  })
  try {
    while (true) {
      const { done, value } = await (abortPromise ? Promise.race([reader.read(), abortPromise]) : reader.read())
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        onLimit?.()
        await reader.cancel().catch(() => undefined)
        throw new BodyLimitError(scope)
      }
      chunks.push(value)
    }
  } finally {
    if (abortHandler) signal?.removeEventListener('abort', abortHandler)
    if (signal?.aborted) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

interface BufferedUpstreamResponse {
  response: Response
  body: Uint8Array
}

async function fetchBufferedWithTimeout(
  fetchImpl: GatewayFetch,
  input: URL,
  init: RequestInit,
  maxBytes: number,
  scope: BodyLimitError['scope'],
  timeoutMs: number,
  requestSignal?: AbortSignal
): Promise<BufferedUpstreamResponse> {
  const controller = new AbortController()
  const abortFromRequest = () => controller.abort(requestSignal?.reason)
  if (requestSignal?.aborted) abortFromRequest()
  else requestSignal?.addEventListener('abort', abortFromRequest, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(input, { ...init, signal: controller.signal, redirect: 'manual' })
    if (declaredBodyBytes(response.headers) > maxBytes) {
      controller.abort()
      throw new BodyLimitError(scope)
    }
    const body = await readBodyWithLimit(response.body, maxBytes, scope, () => controller.abort(), controller.signal)
    return { response, body }
  } finally {
    clearTimeout(timer)
    requestSignal?.removeEventListener('abort', abortFromRequest)
  }
}

function upstreamHeaders(config: GatewayConfig, contentType?: string): Headers {
  const headers = new Headers({
    'accept': contentType ? 'application/json' : 'image/avif,image/webp,image/png,image/jpeg,image/gif',
    'x-vercel-protection-bypass': config.bypassSecret,
    'user-agent': 'personal-kitchen-supabase-gateway/1.0'
  })
  if (contentType) headers.set('content-type', contentType)
  return headers
}

function isRedirect(response: Response): boolean {
  return response.status >= 300 && response.status < 400
}

export function createGateway(configInput: GatewayConfig, fetchImpl: GatewayFetch = fetch): (request: Request) => Promise<Response> {
  const config = {
    ...configInput,
    upstreamOrigin: normalizeUpstreamOrigin(configInput.upstreamOrigin),
    allowedOrigin: normalizeOrigin(configInput.allowedOrigin),
    upstreamTimeoutMs: configInput.upstreamTimeoutMs || UPSTREAM_TIMEOUT_MS
  }
  if (!config.bypassSecret || !config.accessKey || !config.allowedOrigin.startsWith('https://') || config.upstreamTimeoutMs <= 0) {
    throw new Error('Gateway configuration is incomplete')
  }

  return async (request: Request): Promise<Response> => {
    const requestUrl = new URL(request.url)
    const origin = normalizeOrigin(request.headers.get('origin') || '')
    const isRecipePath = requestUrl.pathname.endsWith('/api/import/recipe')
    const isHealthPath = requestUrl.pathname.endsWith('/api/health')
    const imageMatch = requestUrl.pathname.match(/\/api\/import\/image\/([^/]+)$/)
    const isImagePath = Boolean(imageMatch)
    const isValidImagePath = Boolean(imageMatch && IMAGE_TOKEN_PATTERN.test(imageMatch[1]))

    if (request.method === 'OPTIONS') {
      if (origin !== config.allowedOrigin || (!isRecipePath && !isHealthPath && !isValidImagePath)) {
        return jsonResponse(403, { success: false, message: 'Origin Not Allowed' })
      }
      return new Response(null, { status: 204, headers: corsHeaders(config.allowedOrigin) })
    }

    if (isRecipePath || isHealthPath || isImagePath) {
      if (origin !== config.allowedOrigin) return jsonResponse(403, { success: false, message: 'Origin Not Allowed' })
      if (!constantTimeEqual(request.headers.get('x-kitchen-access') || '', config.accessKey)) {
        return jsonResponse(401, { success: false, errorCode: 'ACCESS_DENIED', message: '解析服务访问码无效' }, corsHeaders(config.allowedOrigin))
      }
    }

    try {
      if (isHealthPath && request.method === 'GET') {
        const { response, body } = await fetchBufferedWithTimeout(fetchImpl, new URL('/api/health', config.upstreamOrigin), {
          method: 'GET', headers: upstreamHeaders(config)
        }, MAX_HEALTH_BYTES, 'health-response', config.upstreamTimeoutMs, request.signal)
        if (isRedirect(response)) return jsonResponse(502, { ok: false, message: 'Upstream redirect rejected' }, corsHeaders(config.allowedOrigin))
        return new Response(new TextDecoder().decode(body), {
          status: response.status,
          headers: { ...corsHeaders(config.allowedOrigin), 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' }
        })
      }

      if (isRecipePath && request.method === 'POST') {
        const declaredLength = Number(request.headers.get('content-length') || 0)
        if (declaredLength > MAX_JSON_BYTES) return jsonResponse(413, { success: false, errorCode: 'INVALID_URL', message: '请求内容过大' }, corsHeaders(config.allowedOrigin))
        const requestBytes = await readBodyWithLimit(request.body, MAX_JSON_BYTES, 'request', undefined, request.signal)
        const requestBody = new TextDecoder().decode(requestBytes)
        const headers = upstreamHeaders(config, 'application/json')
        headers.set('origin', config.allowedOrigin)
        const { response, body } = await fetchBufferedWithTimeout(fetchImpl, new URL('/api/import/recipe', config.upstreamOrigin), {
          method: 'POST', headers, body: requestBody
        }, MAX_JSON_RESPONSE_BYTES, 'recipe-response', config.upstreamTimeoutMs, request.signal)
        if (isRedirect(response)) return jsonResponse(502, { success: false, errorCode: 'SERVICE_UNAVAILABLE', message: '解析服务重定向已拒绝' }, corsHeaders(config.allowedOrigin))
        let payload: unknown
        try {
          payload = JSON.parse(new TextDecoder().decode(body))
        } catch {
          return jsonResponse(502, { success: false, errorCode: 'SERVICE_UNAVAILABLE', message: '解析服务返回格式异常' }, corsHeaders(config.allowedOrigin))
        }
        return jsonResponse(response.status, rewriteRelayUrls(payload, config.upstreamOrigin, gatewayBaseFromRequest(requestUrl)), corsHeaders(config.allowedOrigin))
      }

      if (imageMatch && request.method === 'GET') {
        const token = imageMatch[1]
        const imageCors = origin === config.allowedOrigin ? corsHeaders(config.allowedOrigin) : {}
        if (!IMAGE_TOKEN_PATTERN.test(token)) return jsonResponse(400, { success: false, message: '图片 token 格式无效' }, imageCors)
        const { response, body } = await fetchBufferedWithTimeout(fetchImpl, new URL(`/api/import/image/${token}`, config.upstreamOrigin), {
          method: 'GET', headers: upstreamHeaders(config)
        }, MAX_IMAGE_BYTES, 'image-response', config.upstreamTimeoutMs, request.signal)
        if (isRedirect(response)) return jsonResponse(502, { success: false, message: '图片服务重定向已拒绝' }, imageCors)
        const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
        if (response.ok && !SAFE_IMAGE_TYPES.has(contentType)) return jsonResponse(502, { success: false, message: '图片类型不安全' }, imageCors)
        return new Response(copyToArrayBuffer(body), {
          status: response.status,
          headers: {
            ...imageCors,
            'content-type': response.ok ? contentType : 'application/json; charset=utf-8',
            'content-length': String(body.byteLength),
            'cache-control': response.ok ? 'private, max-age=300' : 'no-store',
            'x-content-type-options': 'nosniff',
            'content-security-policy': "sandbox; default-src 'none'",
            'referrer-policy': 'no-referrer'
          }
        })
      }

      if (isRecipePath || isHealthPath || isImagePath) {
        return jsonResponse(405, { success: false, message: 'Method Not Allowed' }, corsHeaders(config.allowedOrigin))
      }
      return jsonResponse(404, { success: false, message: 'Not Found' })
    } catch (error) {
      if (error instanceof BodyLimitError) {
        if (error.scope === 'request') return jsonResponse(413, { success: false, errorCode: 'INVALID_URL', message: '请求内容过大' }, corsHeaders(config.allowedOrigin))
        if (error.scope === 'image-response') return jsonResponse(413, { success: false, message: '图片超过 4 MB 限制' }, origin === config.allowedOrigin ? corsHeaders(config.allowedOrigin) : {})
        return jsonResponse(502, { success: false, errorCode: 'SERVICE_UNAVAILABLE', message: '解析服务响应过大' }, corsHeaders(config.allowedOrigin))
      }
      const isTimeout = error instanceof DOMException && error.name === 'AbortError'
      return jsonResponse(isTimeout ? 504 : 502, {
        success: false,
        errorCode: 'SERVICE_UNAVAILABLE',
        message: isTimeout ? '解析网关等待超时' : '解析网关暂时不可用'
      }, origin === config.allowedOrigin ? corsHeaders(config.allowedOrigin) : {})
    }
  }
}
