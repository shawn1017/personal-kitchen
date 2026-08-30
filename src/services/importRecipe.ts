import Taro from '@tarojs/taro'
import { ImportRecipeResponse, ImportedRecipeDraft } from '@/types'
import { normalizeDraft } from '@/utils/recipeNormalizer'

export type DetectedSourcePlatform = 'xiaohongshu' | 'xiachufang' | 'unknown'
export const IMPORT_TIMEOUT_MS = 15_000

export interface ImportSignal {
  readonly aborted: boolean
  subscribe: (listener: () => void) => () => void
}

export interface ImportController {
  signal: ImportSignal
  abort: () => void
}

export function createImportController(): ImportController {
  let aborted = false
  const listeners = new Set<() => void>()
  return {
    signal: {
      get aborted() { return aborted },
      subscribe(listener) {
        if (aborted) listener()
        else listeners.add(listener)
        return () => listeners.delete(listener)
      }
    },
    abort() {
      if (aborted) return
      aborted = true
      listeners.forEach((listener) => listener())
      listeners.clear()
    }
  }
}

export function detectSourcePlatform(url: string): DetectedSourcePlatform {
  const value = url.trim().toLowerCase()
  if (/https?:\/\/(?:[^/]+\.)?(?:xiaohongshu\.com|xhslink\.com)(?:\/|$)/.test(value)) return 'xiaohongshu'
  if (/https?:\/\/(?:[^/]+\.)?xiachufang\.com(?:\/|$)/.test(value)) return 'xiachufang'
  return 'unknown'
}

export function getImportApiBase(): string {
  const configured = String(process.env.TARO_APP_IMPORT_API_BASE || '').trim()
  if (configured !== 'same-origin') return configured.replace(/\/$/, '')
  if (Taro.getEnv() !== Taro.ENV_TYPE.WEB || typeof window === 'undefined') return ''
  return window.location.origin
}

function isGatewayApiBase(apiBase: string): boolean {
  try {
    const parsed = new URL(apiBase)
    const pathname = parsed.pathname.replace(/\/$/, '')
    return parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      parsed.hostname.toLowerCase().endsWith('.supabase.co') &&
      /^\/functions\/v1\/[^/]+$/.test(pathname)
  } catch {
    return false
  }
}

export function isGatewayImportService(): boolean {
  return isGatewayApiBase(getImportApiBase())
}

export function isImportServiceConfigured(): boolean {
  return Boolean(getImportApiBase())
}

function cancelledResult(): ImportRecipeResponse {
  return { success: false, errorCode: 'CANCELLED', message: '已取消导入，没有保存任何内容。' }
}

export async function importRecipe(url: string, accessKeyInput = '', signal?: ImportSignal): Promise<ImportRecipeResponse> {
  const apiBase = getImportApiBase()
  if (!apiBase) return { success: false, errorCode: 'SERVICE_UNAVAILABLE', message: '尚未配置导入服务地址，可粘贴原文继续创建草稿。' }
  const gatewayService = isGatewayApiBase(apiBase)
  const accessKey = gatewayService ? accessKeyInput.trim() : ''
  if (gatewayService && !accessKey) return { success: false, errorCode: 'ACCESS_DENIED', message: '请先填写解析服务访问码。' }
  if (signal?.aborted) return cancelledResult()

  let abortRequest: () => void = () => undefined
  let unsubscribe: () => void = () => undefined
  const cancelled = new Promise<ImportRecipeResponse>((resolve) => {
    unsubscribe = signal?.subscribe(() => {
      abortRequest()
      resolve(cancelledResult())
    }) || unsubscribe
  })

  try {
    const requestTask = Taro.request<ImportRecipeResponse>({
      url: `${apiBase}/api/import/recipe`,
      method: 'POST',
      data: { url },
      timeout: IMPORT_TIMEOUT_MS,
      header: {
        'content-type': 'application/json',
        ...(accessKey ? { 'x-kitchen-access': accessKey } : {})
      }
    })
    abortRequest = () => requestTask.abort?.()
    const response = await Promise.race([requestTask, cancelled])
    if ('success' in response) return response
    const body = response.data
    if (body.success) return { ...body, data: normalizeDraft(body.data, url) }
    return body
  } catch (error) {
    if (signal?.aborted) return cancelledResult()
    const detail = String((error as { errMsg?: string })?.errMsg || (error as Error)?.message || '')
    if (/timeout/i.test(detail)) return { success: false, errorCode: 'SOURCE_TIMEOUT', message: '读取超过 15 秒，已停止等待。可稍后重试或粘贴原文继续。' }
    return { success: false, errorCode: 'SERVICE_UNAVAILABLE', message: '导入服务暂时不可用，可粘贴原文继续创建草稿。' }
  } finally {
    unsubscribe()
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
