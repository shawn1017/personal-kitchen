import { assertPublicDestination, assertSupportedRedirect } from './security.js'
import { ImportError, Platform } from './types.js'

const MAX_PAGE_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_REDIRECTS = 3
const TIMEOUT_MS = 8000

export function isAccessChallenge(html: string, url: URL): boolean {
  const path = decodeURIComponent(url.pathname).toLowerCase()
  if (/(?:captcha|humancheck|verify|challenge|\/auth\/|\/login(?:\/|$))/.test(path)) return true
  const title = html.match(/<title[^>]*>([\s\S]{0,240}?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() || ''
  return /^(?:滑动验证|安全验证|访问验证|登录|用户登录|just a moment|access denied)/i.test(title)
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > limit) throw new ImportError('SOURCE_BLOCKED', '来源内容超过允许大小')
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) { await reader.cancel(); throw new ImportError('SOURCE_BLOCKED', '来源内容超过允许大小') }
    chunks.push(value)
  }
  const output = new Uint8Array(size)
  let offset = 0
  chunks.forEach((chunk) => { output.set(chunk, offset); offset += chunk.byteLength })
  return output
}

interface PendingResponse {
  response: Response
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
}

function cancelPending(pending: PendingResponse): void {
  clearTimeout(pending.timer)
  pending.controller.abort()
}

async function readPending(pending: PendingResponse, limit: number): Promise<Uint8Array> {
  try {
    return await readLimited(pending.response, limit)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new ImportError('SOURCE_TIMEOUT', '读取来源内容超时')
    throw error
  } finally {
    clearTimeout(pending.timer)
  }
}

async function fetchOnce(url: URL): Promise<PendingResponse> {
  await assertPublicDestination(url)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'user-agent': 'PersonalKitchenRecipeImporter/1.0 (+local personal tool)',
        accept: 'text/html,application/xhtml+xml,image/avif,image/webp,image/*;q=0.8,*/*;q=0.5',
        'accept-language': 'zh-CN,zh;q=0.9'
      }
    })
    return { response, controller, timer }
  } catch (error) {
    clearTimeout(timer)
    if (error instanceof Error && error.name === 'AbortError') throw new ImportError('SOURCE_TIMEOUT', '读取来源页面超时')
    throw new ImportError('SOURCE_BLOCKED', '无法读取公开来源页面')
  }
}

export async function fetchPage(initialUrl: URL, platform: Platform): Promise<{ html: string; finalUrl: URL }> {
  let url = initialUrl
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const pending = await fetchOnce(url)
    const response = pending.response
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      cancelPending(pending)
      if (redirectCount === MAX_REDIRECTS) throw new ImportError('SOURCE_BLOCKED', '来源页面重定向次数过多')
      const location = response.headers.get('location')
      if (!location) throw new ImportError('SOURCE_BLOCKED', '来源页面返回了无效重定向')
      url = new URL(location, url)
      assertSupportedRedirect(url, platform)
      continue
    }
    if (response.status === 401 || response.status === 403 || response.status === 429) { cancelPending(pending); throw new ImportError('SOURCE_BLOCKED', '平台限制了公开访问，请粘贴原文继续') }
    if (!response.ok) { cancelPending(pending); throw new ImportError('SOURCE_BLOCKED', `来源页面返回 HTTP ${response.status}`) }
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) { cancelPending(pending); throw new ImportError('PARSE_FAILED', '来源地址不是可解析的网页') }
    const bytes = await readPending(pending, MAX_PAGE_BYTES)
    const html = new TextDecoder().decode(bytes)
    if (isAccessChallenge(html, url)) throw new ImportError('SOURCE_BLOCKED', '平台要求登录或人机验证，请粘贴原文继续')
    return { html, finalUrl: url }
  }
  throw new ImportError('SOURCE_BLOCKED', '来源页面重定向次数过多')
}

export async function fetchImage(initialUrl: URL): Promise<{ bytes: Uint8Array; contentType: string }> {
  let url = initialUrl
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const pending = await fetchOnce(url)
    const response = pending.response
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      cancelPending(pending)
      if (redirectCount === MAX_REDIRECTS) throw new ImportError('SOURCE_BLOCKED', '图片重定向次数过多')
      const location = response.headers.get('location')
      if (!location) throw new ImportError('SOURCE_BLOCKED', '图片地址返回了无效重定向')
      url = new URL(location, url)
      if (!['http:', 'https:'].includes(url.protocol)) throw new ImportError('SOURCE_BLOCKED', '图片协议不受支持')
      continue
    }
    if (!response.ok) { cancelPending(pending); throw new ImportError('SOURCE_BLOCKED', `图片返回 HTTP ${response.status}`) }
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.toLowerCase().startsWith('image/')) { cancelPending(pending); throw new ImportError('SOURCE_BLOCKED', '目标资源不是图片') }
    return { bytes: await readPending(pending, MAX_IMAGE_BYTES), contentType }
  }
  throw new ImportError('SOURCE_BLOCKED', '图片重定向次数过多')
}
