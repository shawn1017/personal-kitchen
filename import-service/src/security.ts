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
  const [a, b, c] = parts
  return a === 0
    || a === 10
    || (a === 100 && b >= 64 && b <= 127)
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
}

function parseIpv6Words(ip: string): number[] | null {
  let normalized = ip.toLowerCase().split('%', 1)[0]
  const ipv4Tail = normalized.slice(normalized.lastIndexOf(':') + 1)
  if (net.isIP(ipv4Tail) === 4) {
    const octets = ipv4Tail.split('.').map(Number)
    normalized = `${normalized.slice(0, normalized.lastIndexOf(':') + 1)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`
  }

  const compressed = normalized.split('::')
  if (compressed.length > 2) return null
  const left = compressed[0] ? compressed[0].split(':') : []
  const right = compressed.length === 2 && compressed[1] ? compressed[1].split(':') : []
  const missing = 8 - left.length - right.length
  if ((compressed.length === 1 && missing !== 0) || (compressed.length === 2 && missing < 1)) return null
  const segments = compressed.length === 2
    ? [...left, ...Array.from({ length: missing }, () => '0'), ...right]
    : left
  if (segments.length !== 8 || segments.some((segment) => !/^[0-9a-f]{1,4}$/.test(segment))) return null
  return segments.map((segment) => Number.parseInt(segment, 16))
}

function isPrivateIpv6(ip: string): boolean {
  const words = parseIpv6Words(ip)
  if (!words) return true

  // IPv4-mapped IPv6 can use either dotted decimal or compressed hex notation.
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return isPrivateIpv4(`${words[6] >>> 8}.${words[6] & 0xff}.${words[7] >>> 8}.${words[7] & 0xff}`)
  }

  const isLegacyCompatible = words.slice(0, 6).every((word) => word === 0)
  const isTranslationPrefix = (words[0] === 0x0064 && words[1] === 0xff9b && words.slice(2, 6).every((word) => word === 0))
    || (words[0] === 0x0064 && words[1] === 0xff9b && words[2] === 0x0001)
  const isDiscardOnly = words[0] === 0x0100 && words.slice(1, 4).every((word) => word === 0)
  const isIetfReserved = words[0] === 0x2001 && (words[1] & 0xfe00) === 0
  const isDocumentation = (words[0] === 0x2001 && words[1] === 0x0db8)
    || (words[0] === 0x3fff && (words[1] & 0xf000) === 0)
  const isSixToFour = words[0] === 0x2002
  const isSegmentRoutingSid = words[0] === 0x5f00
  const isOutsideGlobalUnicast = (words[0] & 0xe000) !== 0x2000
  const isUniqueLocal = (words[0] & 0xfe00) === 0xfc00
  const isLinkLocal = (words[0] & 0xffc0) === 0xfe80
  const isDeprecatedSiteLocal = (words[0] & 0xffc0) === 0xfec0
  const isMulticast = (words[0] & 0xff00) === 0xff00

  return isLegacyCompatible
    || isTranslationPrefix
    || isDiscardOnly
    || isIetfReserved
    || isDocumentation
    || isSixToFour
    || isSegmentRoutingSid
    || isOutsideGlobalUnicast
    || isUniqueLocal
    || isLinkLocal
    || isDeprecatedSiteLocal
    || isMulticast
}

export function isPrivateIp(ip: string): boolean {
  const unwrapped = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip
  const version = net.isIP(unwrapped)
  if (version === 4) return isPrivateIpv4(unwrapped)
  if (version === 6) return isPrivateIpv6(unwrapped)
  return true
}

export async function assertPublicDestination(url: URL): Promise<void> {
  const rawHostname = url.hostname.toLowerCase().replace(/\.$/, '')
  const hostname = rawHostname.startsWith('[') && rawHostname.endsWith(']') ? rawHostname.slice(1, -1) : rawHostname
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
