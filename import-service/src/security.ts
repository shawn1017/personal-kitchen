import dns from 'node:dns/promises'
import net from 'node:net'
import { ImportError, Platform } from './types.js'

const sourceHosts: Record<Platform, string[]> = {
  xiaohongshu: ['xiaohongshu.com', 'xhslink.com'],
  xiachufang: ['xiachufang.com']
}

function hostMatches(hostname: string, base: string): boolean {
  return hostname === base || hostname.endsWith(`.${base}`)
}

export function detectPlatform(url: URL): Platform | null {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (sourceHosts.xiaohongshu.some((host) => hostMatches(hostname, host))) return 'xiaohongshu'
  if (sourceHosts.xiachufang.some((host) => hostMatches(hostname, host))) return 'xiachufang'
  return null
}

export function parseSourceUrl(value: unknown): { url: URL; platform: Platform } {
  if (typeof value !== 'string' || value.length > 2048) throw new ImportError('INVALID_URL', '请输入有效的公开菜谱链接')
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new ImportError('INVALID_URL', '链接格式不正确') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new ImportError('INVALID_URL', '仅支持不含账号信息的 http / https 链接')
  const platform = detectPlatform(url)
  if (!platform) throw new ImportError('UNSUPPORTED_SOURCE', '目前只支持小红书和下厨房公开链接')
  return { url, platform }
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase()
  return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.') || normalized.startsWith('::ffff:192.168.')
}

export function isPrivateIp(ip: string): boolean {
  const version = net.isIP(ip)
  if (version === 4) return isPrivateIpv4(ip)
  if (version === 6) return isPrivateIpv6(ip)
  return true
}

export async function assertPublicDestination(url: URL): Promise<void> {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) throw new ImportError('SOURCE_BLOCKED', '目标地址不允许访问')
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new ImportError('SOURCE_BLOCKED', '目标地址不允许访问')
    return
  }
  let records: Array<{ address: string }>
  try { records = await dns.lookup(hostname, { all: true, verbatim: true }) } catch { throw new ImportError('SOURCE_BLOCKED', '无法解析目标域名') }
  if (!records.length || records.some((record) => isPrivateIp(record.address))) throw new ImportError('SOURCE_BLOCKED', '目标域名解析到了受限网络地址')
}

export function assertSupportedRedirect(url: URL, platform: Platform): void {
  if (detectPlatform(url) !== platform) throw new ImportError('SOURCE_BLOCKED', '来源页面跳转到了不受支持的站点')
}
