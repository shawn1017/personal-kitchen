import Taro from '@tarojs/taro'
import { ImportRecipeResponse, ImportedRecipeDraft } from '@/types'
import { normalizeDraft } from '@/utils/recipeNormalizer'

export type DetectedSourcePlatform = 'xiaohongshu' | 'xiachufang' | 'unknown'

export function detectSourcePlatform(url: string): DetectedSourcePlatform {
  const value = url.trim().toLowerCase()
  if (/https?:\/\/(?:[^/]+\.)?(?:xiaohongshu\.com|xhslink\.com)(?:\/|$)/.test(value)) return 'xiaohongshu'
  if (/https?:\/\/(?:[^/]+\.)?xiachufang\.com(?:\/|$)/.test(value)) return 'xiachufang'
  return 'unknown'
}

function getApiBase(): string {
  return String(process.env.TARO_APP_IMPORT_API_BASE || '').replace(/\/$/, '')
}

export async function importRecipe(url: string): Promise<ImportRecipeResponse> {
  const apiBase = getApiBase()
  if (!apiBase) return { success: false, errorCode: 'SERVICE_UNAVAILABLE', message: '尚未配置导入服务地址，可粘贴原文继续创建草稿。' }
  try {
    const response = await Taro.request<ImportRecipeResponse>({
      url: `${apiBase}/api/import/recipe`,
      method: 'POST',
      data: { url },
      timeout: 15000,
      header: { 'content-type': 'application/json' }
    })
    const body = response.data
    if (body.success) return { ...body, data: normalizeDraft(body.data, url) }
    return body
  } catch {
    return { success: false, errorCode: 'SERVICE_UNAVAILABLE', message: '导入服务暂时不可用，可粘贴原文继续创建草稿。' }
  }
}

export function createManualDraft(sourceUrl: string, rawContent: string): ImportedRecipeDraft {
  return normalizeDraft({
    title: rawContent.split('\n').map((item) => item.trim()).find(Boolean)?.slice(0, 40) || '未命名菜谱',
    rawContent,
    source: { platform: 'manual', sourceUrl, importedAt: Date.now(), rawContent },
    warnings: ['自动解析未完成，已根据你提供的原文生成可编辑草稿。']
  }, sourceUrl)
}
