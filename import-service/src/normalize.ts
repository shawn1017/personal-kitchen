import crypto from 'node:crypto'
import { Ingredient, Platform, RecipeStep } from './types.js'

export const createId = (prefix: string): string => `${prefix}_${crypto.randomBytes(6).toString('hex')}`

const categoryRules: Array<[string, RegExp]> = [
  ['肉类', /鸡|鸭|猪|牛|羊|排骨|肉/], ['海鲜', /鱼|虾|蟹|贝|鲍|鱿鱼/],
  ['蔬菜', /青菜|茄子|豆角|西兰花|菠菜|白菜|萝卜/], ['汤类', /汤|羹/],
  ['主食', /饭|面|粉|饺子|馄饨|包子|馒头/], ['甜点', /蛋糕|布丁|糖水|甜品|饼干/]
]

export function inferCategory(text: string): string {
  return categoryRules.find(([, rule]) => rule.test(text))?.[0] || '其他'
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object' && 'text' in value) return String((value as { text: unknown }).text || '').trim()
  return ''
}

export function normalizeIngredients(value: unknown): Ingredient[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    const text = textValue(item)
    const matched = text.match(/^(.+?)\s+(\d+(?:\.\d+)?(?:\s*[-~至]\s*\d+(?:\.\d+)?)?|适量|少许)\s*([^\s]*)$/)
    return {
      id: createId('ingredient'),
      name: matched?.[1]?.trim() || text,
      amount: matched?.[2]?.replace(/\s+/g, '') || undefined,
      unit: matched?.[3]?.trim() || undefined,
      sort: index
    }
  }).filter((item) => item.name)
}

export function normalizeSteps(value: unknown): RecipeStep[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === 'string') return [{ text: item, image: undefined }]
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (Array.isArray(record.itemListElement)) return normalizeSteps(record.itemListElement).map((step) => ({ text: step.text, image: step.image }))
    const image = typeof record.image === 'string' ? record.image : (record.image && typeof record.image === 'object' && 'url' in record.image ? String((record.image as { url: unknown }).url) : undefined)
    return [{ text: textValue(record.text || record.name), image }]
  }).filter((item) => item.text || item.image).map((item, index) => ({ id: createId('step'), sort: index, ...item }))
}

export function splitSteps(rawContent: string): RecipeStep[] {
  const parts = rawContent.split(/(?:^|\n)\s*(?:步骤\s*\d+|第[一二三四五六七八九十]+步|[①②③④⑤⑥⑦⑧⑨⑩]|\d+[.、])\s*/).map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2) return []
  return parts.map((text, index) => ({ id: createId('step'), sort: index, text }))
}

export function cleanTitle(title: string, platform: Platform): string {
  return title.replace(platform === 'xiaohongshu' ? /\s*[-|_]\s*小红书.*$/i : /\s*[-|_]\s*下厨房.*$/i, '').trim().slice(0, 100)
}

export function uniqueUrls(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && /^https?:\/\//i.test(value))))]
}
