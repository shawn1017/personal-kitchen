import * as cheerio from 'cheerio'
import { uniqueUrls } from '../normalize.js'

export function metadataFromHtml(html: string): { title: string; description: string; images: string[]; author?: string } {
  const $ = cheerio.load(html)
  const title = $('meta[property="og:title"]').attr('content') || $('meta[name="twitter:title"]').attr('content') || $('title').text()
  const description = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || ''
  const images = uniqueUrls([
    ...$('meta[property="og:image"]').map((_, element) => $(element).attr('content')).get(),
    ...$('meta[name="twitter:image"]').map((_, element) => $(element).attr('content')).get()
  ])
  const author = $('meta[name="author"]').attr('content') || undefined
  return { title: title.trim(), description: description.trim(), images, author }
}

function flattenJsonLd(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd)
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const graph = Array.isArray(record['@graph']) ? flattenJsonLd(record['@graph']) : []
  return [record].concat(graph)
}

export function findRecipeJsonLd(html: string): Record<string, unknown> | undefined {
  const $ = cheerio.load(html)
  const values: Array<Record<string, unknown>> = []
  $('script[type="application/ld+json"]').each((_, element) => {
    const text = $(element).text().trim()
    if (!text) return
    try { values.push(...flattenJsonLd(JSON.parse(text))) } catch { return }
  })
  return values.find((record) => record['@type'] === 'Recipe' || (Array.isArray(record['@type']) && record['@type'].includes('Recipe')))
}

export function imageUrlsFromJsonLd(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return uniqueUrls(value.flatMap(imageUrlsFromJsonLd))
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return uniqueUrls([typeof record.url === 'string' ? record.url : undefined, typeof record.contentUrl === 'string' ? record.contentUrl : undefined])
  }
  return []
}
