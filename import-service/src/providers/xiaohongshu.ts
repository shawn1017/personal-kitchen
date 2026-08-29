import * as cheerio from 'cheerio'
import { cleanTitle, inferCategory, splitSteps, uniqueUrls } from '../normalize.js'
import { ImportError, ProviderResult } from '../types.js'
import { metadataFromHtml } from './common.js'

function visibleImages(html: string): string[] {
  const $ = cheerio.load(html)
  return uniqueUrls($('img').map((_, element) => $(element).attr('data-src') || $(element).attr('src')).get())
}

export function parseXiaohongshu(html: string, sourceUrl: string): ProviderResult {
  const meta = metadataFromHtml(html)
  const title = cleanTitle(meta.title, 'xiaohongshu')
  const rawContent = meta.description
  const images = uniqueUrls([...meta.images, ...visibleImages(html)]).slice(0, 30)
  const steps = splitSteps(rawContent).map((step, index) => ({ ...step, image: images[index + 1] }))
  const warnings = ['小红书页面结构可能受平台限制，请在保存前核对原文、图片和步骤。']
  if (!steps.length) warnings.push('原文没有明确步骤编号，已保留原始正文供手工整理。')
  if (!title && !rawContent && !images.length) throw new ImportError('PARSE_FAILED', '页面已读取，但没有找到可用公开内容')
  return {
    draft: {
      title: title || '未命名菜谱', coverImage: images[0], galleryImages: images, rawContent,
      ingredients: [], steps, tips: '', categorySuggestion: inferCategory(`${title} ${rawContent}`),
      source: { platform: 'xiaohongshu', sourceUrl, authorName: meta.author, importedAt: Date.now(), rawTitle: meta.title, rawContent }, warnings
    },
    warnings
  }
}
