import assert from 'node:assert/strict'
import { once } from 'node:events'
import { AddressInfo } from 'node:net'
import test from 'node:test'
import { fetchImage, normalizeImageContentType } from '../src/fetcher.js'
import { assertPublicDestination, isPrivateIp } from '../src/security.js'
import app from '../src/server.js'
import { ImportError } from '../src/types.js'

test('IPv4-mapped IPv6 使用完整 IPv4 特殊地址判定', () => {
  assert.equal(isPrivateIp('::ffff:127.0.0.1'), true)
  assert.equal(isPrivateIp('::ffff:10.0.0.1'), true)
  assert.equal(isPrivateIp('::ffff:ac10:1'), true)
  assert.equal(isPrivateIp('::ffff:c0a8:101'), true)
  assert.equal(isPrivateIp('::ffff:6440:1'), true)
  assert.equal(isPrivateIp('::ffff:8.8.8.8'), false)
  assert.equal(isPrivateIp('::ffff:808:808'), false)
})

test('IPv6 私网、链路本地、组播和保留范围不可作为取源目标', async () => {
  for (const address of [
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fe80::1%lo0',
    'fec0::1',
    'ff02::1',
    '64:ff9b::a00:1',
    '100::1',
    '2001::1',
    '2001:db8::1',
    '2002:a00:1::',
    '3fff::1',
    '5f00::1',
    '4000::1',
    '8000::1'
  ]) assert.equal(isPrivateIp(address), true, `${address} should be blocked`)

  assert.equal(isPrivateIp('2001:4860:4860::8888'), false)
  await assert.rejects(
    assertPublicDestination(new URL('http://[::ffff:127.0.0.1]/image.png')),
    (error) => error instanceof ImportError && error.code === 'SOURCE_BLOCKED'
  )
})

test('图片 MIME 只允许安全位图格式并规范化参数', () => {
  assert.equal(normalizeImageContentType(' IMAGE/PNG ; charset=binary'), 'image/png')
  assert.equal(normalizeImageContentType('image/jpeg'), 'image/jpeg')
  assert.equal(normalizeImageContentType('image/webp; q=1'), 'image/webp')
  assert.equal(normalizeImageContentType('image/avif'), 'image/avif')
  assert.equal(normalizeImageContentType('image/gif'), 'image/gif')
  assert.equal(normalizeImageContentType('image/svg+xml'), null)
  assert.equal(normalizeImageContentType('image/bmp'), null)
  assert.equal(normalizeImageContentType('text/html'), null)
})

test('fetchImage 明确拒绝 SVG 并返回规范化后的 MIME', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = (async () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
      status: 200,
      headers: { 'content-type': 'image/PNG; charset=binary' }
    })) as typeof fetch
    const image = await fetchImage(new URL('https://8.8.8.8/image.png'))
    assert.equal(image.contentType, 'image/png')

    globalThis.fetch = (async () => new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', {
      status: 200,
      headers: { 'content-type': 'image/svg+xml; charset=utf-8' }
    })) as typeof fetch
    await assert.rejects(
      fetchImage(new URL('https://8.8.8.8/image.svg')),
      (error) => error instanceof ImportError && error.code === 'SOURCE_BLOCKED' && error.message.includes('SVG')
    )

    globalThis.fetch = (async () => new Response(new Uint8Array([0x89]), {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'content-length': String(4 * 1024 * 1024 + 1)
      }
    })) as typeof fetch
    await assert.rejects(
      fetchImage(new URL('https://8.8.8.8/oversized.png')),
      (error) => error instanceof ImportError && error.code === 'SOURCE_BLOCKED' && error.message.includes('超过允许大小')
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('图片中转响应带有禁止嗅探和执行的安全头', async (context) => {
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  }))
  const address = server.address() as AddressInfo
  const response = await fetch(`http://127.0.0.1:${address.port}/api/import/image/unregistered`)
  assert.equal(response.status, 404)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('content-security-policy'), "sandbox; default-src 'none'")
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
})
