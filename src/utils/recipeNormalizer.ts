import { ImportedRecipeDraft, RecipeIngredient, RecipeStep } from '@/types'
import { createId } from './id'

const categoryRules: Array<[string, RegExp]> = [
  ['肉类', /鸡|鸭|猪|牛|羊|排骨|肉/],
  ['海鲜', /鱼|虾|蟹|贝|鲍|鱿鱼/],
  ['蔬菜', /青菜|茄子|豆角|西兰花|菠菜|白菜|萝卜/],
  ['汤类', /汤|羹/],
  ['主食', /饭|面|粉|饺子|馄饨|包子|馒头/],
  ['甜点', /蛋糕|布丁|糖水|甜品|饼干/]
]

export function inferCategory(text: string): string {
  return categoryRules.find(([, rule]) => rule.test(text))?.[0] || '其他'
}

export function splitRawContent(rawContent: string): RecipeStep[] {
  const content = rawContent.trim()
  if (!content) return []
  const chunks = content.split(/(?:^|\n)\s*(?:步骤\s*\d+|第[一二三四五六七八九十]+步|[①②③④⑤⑥⑦⑧⑨⑩]|\d+[.、])\s*/).map((item) => item.trim()).filter(Boolean)
  if (chunks.length < 2) return []
  return chunks.map((text, index) => ({ id: createId('step'), sort: index, text }))
}

export function normalizeDraft(input: Partial<ImportedRecipeDraft>, sourceUrl = ''): ImportedRecipeDraft {
  const rawContent = String(input.rawContent || '')
  const galleryImages = Array.isArray(input.galleryImages) ? input.galleryImages.filter(Boolean) : []
  const ingredients = Array.isArray(input.ingredients) ? input.ingredients : []
  let steps = Array.isArray(input.steps) ? input.steps : []
  if (!steps.length) steps = splitRawContent(rawContent)
  if (!steps.length && galleryImages.length > 1) {
    steps = galleryImages.slice(1).map((image, index) => ({ id: createId('step'), sort: index, text: '', image }))
  }
  return {
    title: String(input.title || '未命名菜谱'),
    coverImage: input.coverImage || galleryImages[0],
    galleryImages,
    rawContent,
    ingredients: ingredients.map((item: RecipeIngredient, index) => ({ ...item, id: item.id || createId('ingredient'), sort: index })),
    steps: steps.map((item: RecipeStep, index) => ({ ...item, id: item.id || createId('step'), sort: index })),
    tips: String(input.tips || ''),
    categorySuggestion: input.categorySuggestion || inferCategory(`${input.title || ''} ${rawContent}`),
    source: input.source || { platform: 'manual', sourceUrl, importedAt: Date.now() },
    warnings: Array.isArray(input.warnings) ? input.warnings : []
  }
}
