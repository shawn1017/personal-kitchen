import assert from 'node:assert/strict'
import test from 'node:test'
import { createGateway, GatewayFetch } from '../../supabase/functions/vercel-gateway/gateway.ts'

const config = {
  upstreamOrigin: 'https://preview.example.vercel.app',
  bypassSecret: 'server-only-bypass',
  accessKey: 'local-browser-access',
  allowedOrigin: 'https://shawn1017.github.io'
}
const recipeUrl = 'https://project.supabase.co/functions/v1/vercel-gateway/api/import/recipe'
const imageUrl = (token: string) => `https://project.supabase.co/functions/v1/vercel-gateway/api/import/image/${token}`

function request(path = recipeUrl, init: RequestInit = {}): Request {
  return new Request(path, {
    ...init,
    headers: {
      origin: config.allowedOrigin,
      'x-kitchen-access': config.accessKey,
      'content-type': 'application/json',
      ...Object.fromEntries(new Headers(init.headers))
    }
  })
}

test('网关预检只允许 GitHub Pages 来源', async () => {
  const gateway = createGateway(config, async () => { throw new Error('should not fetch') })
  const allowed = await gateway(request(recipeUrl, { method: 'OPTIONS' }))
  assert.equal(allowed.status, 204)
  assert.equal(allowed.headers.get('access-control-allow-origin'), config.allowedOrigin)

  const denied = await gateway(new Request(recipeUrl, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }))
  assert.equal(denied.status, 403)

  const imageAllowed = await gateway(request(imageUrl('p'.repeat(32)), { method: 'OPTIONS' }))
  assert.equal(imageAllowed.status, 204)
  assert.equal(imageAllowed.headers.get('access-control-allow-headers'), 'content-type,x-kitchen-access')

  const invalidImagePath = await gateway(request(imageUrl('short'), { method: 'OPTIONS' }))
  assert.equal(invalidImagePath.status, 403)
})

test('菜谱入口拒绝错误来源和错误访问码', async () => {
  const gateway = createGateway(config, async () => { throw new Error('should not fetch') })
  const wrongOrigin = await gateway(new Request(recipeUrl, {
    method: 'POST', headers: { origin: 'https://evil.example', 'x-kitchen-access': config.accessKey }, body: '{}'
  }))
  assert.equal(wrongOrigin.status, 403)

  const wrongKey = await gateway(request(recipeUrl, { method: 'POST', headers: { 'x-kitchen-access': 'wrong-key' }, body: '{}' }))
  assert.equal(wrongKey.status, 401)
})

test('菜谱请求固定转发到 Vercel 并改写图片地址', async () => {
  const token = 'a'.repeat(32)
  const secondToken = 'd'.repeat(32)
  let observedUrl = ''
  let observedBypass = ''
  const fetchImpl: GatewayFetch = async (input, init) => {
    observedUrl = String(input)
    observedBypass = new Headers(init?.headers).get('x-vercel-protection-bypass') || ''
    return Response.json({
      success: true,
      data: {
        coverImage: `${config.upstreamOrigin}/api/import/image/${token}`,
        galleryImages: [
          `${config.upstreamOrigin}/api/import/image/${token}`,
          `http://project.supabase.co/vercel-gateway/api/import/image/${secondToken}`,
          `https://evil.example/api/import/image/${secondToken}`
        ]
      },
      warnings: []
    })
  }
  const gateway = createGateway(config, fetchImpl)
  const response = await gateway(request(recipeUrl, { method: 'POST', body: JSON.stringify({ url: 'https://www.xiaohongshu.com/explore/demo' }) }))
  const body = await response.json() as { data: { coverImage: string; galleryImages: string[] } }
  assert.equal(response.status, 200)
  assert.equal(observedUrl, `${config.upstreamOrigin}/api/import/recipe`)
  assert.equal(observedBypass, config.bypassSecret)
  assert.equal(body.data.coverImage, `https://project.supabase.co/functions/v1/vercel-gateway/api/import/image/${token}`)
  assert.equal(body.data.galleryImages[1], `https://project.supabase.co/functions/v1/vercel-gateway/api/import/image/${secondToken}`)
  assert.equal(body.data.galleryImages[2], `https://evil.example/api/import/image/${secondToken}`)
})

test('Supabase 内部函数路径改写为公开 HTTPS 网关地址', async () => {
  const token = 'e'.repeat(32)
  const gateway = createGateway(config, async () => Response.json({
    success: true,
    data: { coverImage: `${config.upstreamOrigin}/api/import/image/${token}`, galleryImages: [] },
    warnings: []
  }))
  const internalUrl = 'http://project.supabase.co/vercel-gateway/api/import/recipe'
  const response = await gateway(request(internalUrl, { method: 'POST', body: '{}' }))
  const body = await response.json() as { data: { coverImage: string } }
  assert.equal(response.status, 200)
  assert.equal(body.data.coverImage, `https://project.supabase.co/functions/v1/vercel-gateway/api/import/image/${token}`)
})

test('网关拒绝 Vercel 重定向，避免 bypass 外泄', async () => {
  let calls = 0
  let redirectMode: RequestRedirect | undefined
  const gateway = createGateway(config, async (_input, init) => {
    calls += 1
    redirectMode = init?.redirect
    return new Response(null, { status: 302, headers: { location: 'https://evil.example' } })
  })
  const response = await gateway(request(recipeUrl, { method: 'POST', body: '{}' }))
  assert.equal(response.status, 502)
  assert.equal(redirectMode, 'manual')
  assert.equal(calls, 1)
})

test('图片入口在访问 Vercel 前拒绝错误来源和访问码', async () => {
  let calls = 0
  const gateway = createGateway(config, async () => {
    calls += 1
    throw new Error('should not fetch')
  })
  const validUrl = imageUrl('b'.repeat(32))

  const wrongOrigin = await gateway(new Request(validUrl, {
    headers: { origin: 'https://evil.example', 'x-kitchen-access': config.accessKey }
  }))
  assert.equal(wrongOrigin.status, 403)

  const missingKey = await gateway(new Request(validUrl, {
    headers: { origin: config.allowedOrigin }
  }))
  assert.equal(missingKey.status, 401)

  const wrongKey = await gateway(new Request(validUrl, {
    headers: { origin: config.allowedOrigin, 'x-kitchen-access': 'wrong-key' }
  }))
  assert.equal(wrongKey.status, 401)
  assert.equal(calls, 0)
})

test('图片入口仅接受 32 位 token 并保留安全响应头', async () => {
  let observedBypass = ''
  const gateway = createGateway(config, async (_input, init) => {
    observedBypass = new Headers(init?.headers).get('x-vercel-protection-bypass') || ''
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/webp', 'content-length': '3' } })
  })
  const invalid = await gateway(request(imageUrl('bad')))
  assert.equal(invalid.status, 400)

  const valid = await gateway(request(imageUrl('b'.repeat(32))))
  assert.equal(valid.status, 200)
  assert.equal(observedBypass, config.bypassSecret)
  assert.equal(valid.headers.get('access-control-allow-origin'), config.allowedOrigin)
  assert.equal(valid.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(valid.headers.get('content-security-policy'), "sandbox; default-src 'none'")
  assert.equal(valid.headers.get('referrer-policy'), 'no-referrer')
})

test('图片入口按实际字节拒绝缺少 Content-Length 的超限响应', async () => {
  const oversized = new Uint8Array(4 * 1024 * 1024 + 1)
  const gateway = createGateway(config, async () => new Response(oversized, {
    status: 200,
    headers: { 'content-type': 'image/webp' }
  }))
  const response = await gateway(request(imageUrl('c'.repeat(32))))
  assert.equal(response.status, 413)
})

test('上游总超时覆盖收到响应头后的慢响应体', async () => {
  const gateway = createGateway({ ...config, upstreamTimeoutMs: 20 }, async () => {
    let timer: ReturnType<typeof setTimeout>
    return new Response(new ReadableStream({
      start(controller) {
        timer = setTimeout(() => {
          controller.enqueue(new TextEncoder().encode('{"ok":true}'))
          controller.close()
        }, 80)
      },
      cancel() { clearTimeout(timer) }
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  const response = await gateway(request('https://project.supabase.co/functions/v1/vercel-gateway/api/health', { method: 'GET' }))
  assert.equal(response.status, 504)
})

test('网关拒绝带路径、用户信息或非 Vercel 主机的上游配置', () => {
  for (const upstreamOrigin of [
    'https://preview.example.vercel.app/api',
    'https://preview.example.vercel.app@evil.example',
    'https://evil.example'
  ]) {
    assert.throws(() => createGateway({ ...config, upstreamOrigin }))
  }
})
