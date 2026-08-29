import { cleanTitle, inferCategory, normalizeIngredients, normalizeSteps, uniqueUrls } from '../normalize.js'
import { ImportError, ProviderResult } from '../types.js'
import { findRecipeJsonLd, imageUrlsFromJsonLd, metadataFromHtml } from './common.js'

export function parseXiachufang(html: string, sourceUrl: string): ProviderResult {
  const meta = metadataFromHtml(html)
  const recipe = findRecipeJsonLd(html)
  const title = cleanTitle(String(recipe?.name || meta.title || ''), 'xiachufang')
  const rawContent = String(recipe?.description || meta.description || '').trim()
  const images = uniqueUrls([...imageUrlsFromJsonLd(recipe?.image), ...meta.images])
  const ingredients = normalizeIngredients(recipe?.recipeIngredient)
  const steps = normalizeSteps(recipe?.recipeInstructions)
  const authorValue = recipe?.author
  const authorName = typeof authorValue === 'string' ? authorValue : (authorValue && typeof authorValue === 'object' && 'name' in authorValue ? String((authorValue as { name: unknown }).name) : meta.author)
  const warnings: string[] = []
  if (!recipe) warnings.push('未发现标准 Recipe JSON-LD，已使用页面公开元数据生成草稿。')
  if (!ingredients.length) warnings.push('未提取到结构化用料，请在编辑页补充。')
  if (!steps.length) warnings.push('未提取到结构化步骤，请在编辑页补充。')
  if (!title && !rawContent && !images.length) throw new ImportError('PARSE_FAILED', '页面已读取，但没有找到可用菜谱内容')
  return {
    draft: {
      title: title || '未命名菜谱', coverImage: images[0], galleryImages: images, rawContent,
      ingredients, steps, tips: '', categorySuggestion: inferCategory(`${title} ${rawContent}`),
      source: { platform: 'xiachufang', sourceUrl, authorName, importedAt: Date.now(), rawTitle: meta.title, rawContent }, warnings
    },
    warnings
  }
}
