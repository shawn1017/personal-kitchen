import assert from 'node:assert/strict'
import test from 'node:test'
import { inferCategory, normalizeIngredients, normalizeSteps, splitSteps } from '../src/normalize.js'
import { detectPlatform, isPrivateIp, parseSourceUrl } from '../src/security.js'
import { parseXiachufang } from '../src/providers/xiachufang.js'
import { parseXiaohongshu } from '../src/providers/xiaohongshu.js'
import { consumeRelayToken, relayDraftImages } from '../src/imageRelay.js'
import { isAccessChallenge } from '../src/fetcher.js'

test('识别支持的平台和拦截未知来源', () => {
  assert.equal(detectPlatform(new URL('https://www.xiachufang.com/recipe/1')), 'xiachufang')
  assert.equal(detectPlatform(new URL('https://xhslink.com/abc')), 'xiaohongshu')
  assert.throws(() => parseSourceUrl('http://127.0.0.1/a'))
})

test('内网地址判定覆盖常见范围', () => {
  assert.equal(isPrivateIp('127.0.0.1'), true)
  assert.equal(isPrivateIp('10.0.0.2'), true)
  assert.equal(isPrivateIp('192.168.1.2'), true)
  assert.equal(isPrivateIp('8.8.8.8'), false)
  assert.equal(isPrivateIp('::1'), true)
})

test('规范化结构化用料和步骤', () => {
  const ingredients = normalizeIngredients(['牛肉 200g'])
  assert.equal(ingredients.length, 1)
  assert.equal(ingredients[0].name, '牛肉')
  assert.equal(ingredients[0].amount, '200')
  assert.equal(ingredients[0].unit, 'g')
  assert.equal(normalizeSteps([{ '@type': 'HowToStep', text: '切片' }]).length, 1)
  assert.equal(splitSteps('步骤1 切片\n步骤2 翻炒').length, 2)
  assert.equal(inferCategory('小炒牛肉'), '肉类')
})

test('下厨房优先解析公开 Recipe JSON-LD', () => {
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Recipe', name: '番茄炒蛋', description: '家常快手菜',
    image: ['https://img.example.com/a.jpg'], recipeIngredient: ['番茄 2个', '鸡蛋 3个'],
    recipeInstructions: [{ '@type': 'HowToStep', text: '鸡蛋炒熟' }, { '@type': 'HowToStep', text: '加入番茄' }]
  })}</script></head></html>`
  const result = parseXiachufang(html, 'https://www.xiachufang.com/recipe/1/')
  assert.equal(result.draft.title, '番茄炒蛋')
  assert.equal(result.draft.ingredients.length, 2)
  assert.equal(result.draft.steps.length, 2)
})

test('小红书保留原始正文并按编号拆步骤', () => {
  const html = '<html><head><meta property="og:title" content="啤酒鸭 - 小红书"><meta property="og:description" content="步骤1 焯水\n步骤2 炖煮"><meta property="og:image" content="https://img.example.com/a.jpg"></head></html>'
  const result = parseXiaohongshu(html, 'https://www.xiaohongshu.com/explore/1')
  assert.equal(result.draft.title, '啤酒鸭')
  assert.equal(result.draft.rawContent?.includes('焯水'), true)
  assert.equal(result.draft.steps.length, 2)
})

test('图片中转只接受服务端登记的短期 token', () => {
  const draft = parseXiaohongshu('<meta property="og:title" content="测试"><meta property="og:image" content="https://img.example.com/a.jpg">', 'https://www.xiaohongshu.com/explore/1').draft
  const relayed = relayDraftImages(draft, 'https://service.example.com')
  const token = relayed.coverImage?.split('/').pop() || ''
  assert.equal(consumeRelayToken(token), 'https://img.example.com/a.jpg')
  assert.equal(consumeRelayToken('unregistered'), null)
})

test('登录和滑动验证页面必须进入降级，不能当菜谱成功', () => {
  assert.equal(isAccessChallenge('<title>滑动验证</title>', new URL('https://www.xiachufang.com/auth/humancheck_captcha/')), true)
  assert.equal(isAccessChallenge('<title>番茄炒蛋</title>', new URL('https://www.xiachufang.com/recipe/1/')), false)
})
