import assert from 'node:assert/strict'
import test from 'node:test'

for (const flag of [
  'ENABLE_ADJACENT_HTML',
  'ENABLE_CLONE_NODE',
  'ENABLE_CONTAINS',
  'ENABLE_INNER_HTML',
  'ENABLE_MUTATION_OBSERVER',
  'ENABLE_SIZE_APIS',
  'ENABLE_TEMPLATE_CONTENT'
]) {
  Object.defineProperty(globalThis, flag, { configurable: true, value: false })
}

const { default: Taro } = await import('@tarojs/taro')
const { getGatewayImageAccessHeaders, persistImage } = await import('../../src/utils/images.ts')

const apiBase = 'https://project.supabase.co/functions/v1/vercel-gateway'
const accessKey = 'browser-access-code'
const token = 'a'.repeat(32)
const gatewayImage = `${apiBase}/api/import/image/${token}`

test('只对精确的网关图片 URL 生成访问码请求头', () => {
  assert.deepEqual(getGatewayImageAccessHeaders(gatewayImage, { apiBase, accessKey }), {
    'x-kitchen-access': accessKey
  })

  for (const unsafePath of [
    `https://evil.example/functions/v1/vercel-gateway/api/import/image/${token}`,
    `https://project.supabase.co/functions/v1/another-gateway/api/import/image/${token}`,
    `${apiBase}/api/import/image/${'a'.repeat(31)}`,
    `${gatewayImage}?forward=https://evil.example`,
    'https://sns-webpic-qc.xhscdn.com/example.webp'
  ]) {
    assert.deepEqual(getGatewayImageAccessHeaders(unsafePath, { apiBase, accessKey }), {})
  }
})

test('persistImage 不会向原始小红书 CDN 发送访问码', async () => {
  const originalDownloadFile = Taro.downloadFile
  const originalSaveFile = Taro.saveFile
  const requests: Array<{ url: string; header?: Record<string, string> }> = []
  Taro.downloadFile = (async (options: { url: string; header?: Record<string, string> }) => {
    requests.push(options)
    return { statusCode: 200, tempFilePath: `/tmp/image-${requests.length}` }
  }) as typeof Taro.downloadFile
  Taro.saveFile = (async ({ tempFilePath }: { tempFilePath: string }) => ({ savedFilePath: `${tempFilePath}-saved` })) as typeof Taro.saveFile

  try {
    await persistImage(gatewayImage, undefined, { apiBase, accessKey })
    await persistImage('https://sns-webpic-qc.xhscdn.com/example.webp', undefined, { apiBase, accessKey })
  } finally {
    Taro.downloadFile = originalDownloadFile
    Taro.saveFile = originalSaveFile
  }

  assert.equal(requests.length, 2)
  assert.equal(requests[0].header?.['x-kitchen-access'], accessKey)
  assert.equal(requests[1].header?.['x-kitchen-access'], undefined)
})
