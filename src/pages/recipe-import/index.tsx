import { useEffect, useMemo, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { Button, Input, Textarea, View } from '@tarojs/components'
import { ImportedRecipeDraft } from '@/types'
import { createImportController, createManualDraft, detectSourcePlatform, getImportApiBase, ImportController, ImportSignal, IMPORT_TIMEOUT_MS, importRecipe, isGatewayImportService, isImportServiceConfigured } from '@/services/importRecipe'
import { runWithConcurrency } from '@/utils/async'
import { normalizeDraft } from '@/utils/recipeNormalizer'
import { deletePersistedImages, persistImage, type PersistImageOptions } from '@/utils/images'
import { getStorageStrict, hasStorageKeyStrict, removeStorage, STORAGE_KEYS, setStorage } from '@/utils/storage'
import './index.scss'

type ImportState = 'idle' | 'loading' | 'error' | 'partial'
const steps = ['正在识别来源…', '正在读取标题和正文…', '正在整理图片…', '正在生成菜谱草稿…']

function progressAt(elapsedMs: number): number {
  if (elapsedMs < 1200) return 8 + Math.round(elapsedMs / 200)
  if (elapsedMs < 4000) return 18 + Math.round((elapsedMs - 1200) / 155)
  if (elapsedMs < 9000) return 36 + Math.round((elapsedMs - 4000) / 156)
  return Math.min(92, 68 + Math.round((elapsedMs - 9000) / 250))
}

function stepAt(progress: number): number {
  if (progress < 22) return 0
  if (progress < 50) return 1
  if (progress < 76) return 2
  return 3
}

function extractUrl(value: string): string {
  return value.match(/https?:\/\/[^\s]+/i)?.[0] || value.trim()
}

interface PersistedDraftResult {
  draft: ImportedRecipeDraft
  createdImages: string[]
}

async function persistImportedDraftImages(draft: ImportedRecipeDraft, signal: ImportSignal, options?: PersistImageOptions): Promise<PersistedDraftResult> {
  const imagePaths = [draft.coverImage, ...draft.galleryImages, ...draft.steps.map((step) => step.image)]
    .filter((path): path is string => Boolean(path && /^https?:\/\//i.test(path)))
  const uniquePaths = Array.from(new Set(imagePaths))
  const replacements = new Map<string, string>()
  const abortController = new AbortController()
  let timedOut = false
  const unsubscribe = signal.subscribe(() => abortController.abort(new DOMException('Cancelled', 'AbortError')))
  if (signal.aborted) abortController.abort(new DOMException('Cancelled', 'AbortError'))
  const timeout = setTimeout(() => {
    timedOut = true
    abortController.abort(new DOMException('Image persistence timed out', 'AbortError'))
  }, 20_000)

  try {
    await runWithConcurrency(uniquePaths, 3, async (path) => {
      const saved = await persistImage(path, abortController.signal, options)
      if (saved && saved !== path) replacements.set(path, saved)
    })
    if (abortController.signal.aborted) {
      throw abortController.signal.reason instanceof Error
        ? abortController.signal.reason
        : new DOMException('Aborted', 'AbortError')
    }
  } catch (error) {
    if (signal.aborted || !timedOut) {
      await deletePersistedImages(replacements.values()).catch(() => undefined)
      throw error
    }
  } finally {
    clearTimeout(timeout)
    unsubscribe()
  }

  const failedImages = uniquePaths.length - replacements.size
  const replace = (path?: string): string | undefined => {
    if (!path) return undefined
    if (!/^https?:\/\//i.test(path)) return path
    return replacements.get(path)
  }
  return {
    draft: {
      ...draft,
      coverImage: replace(draft.coverImage),
      galleryImages: draft.galleryImages.map((path) => replace(path) || '').filter(Boolean),
      steps: draft.steps.map((step) => ({ ...step, image: replace(step.image) })),
      warnings: failedImages
        ? [...(draft.warnings || []), `${failedImages} 张图片未能保存到本机${timedOut ? '（已达到 20 秒图片保存上限）' : ''}，已从草稿移除，请稍后手工补图。`]
        : draft.warnings
    },
    createdImages: Array.from(replacements.values())
  }
}

export default function RecipeImportPage() {
  const [input, setInput] = useState('')
  const [rawContent, setRawContent] = useState('')
  const [state, setState] = useState<ImportState>('idle')
  const [message, setMessage] = useState('')
  const [stepIndex, setStepIndex] = useState(0)
  const [progress, setProgress] = useState(0)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [accessKey, setAccessKey] = useState('')
  const activeController = useRef<ImportController | null>(null)
  const mountedRef = useRef(true)
  const serviceConfigured = isImportServiceConfigured()
  const gatewayService = isGatewayImportService()
  const gatewayAccessReady = !gatewayService || Boolean(accessKey.trim())
  const url = useMemo(() => extractUrl(input), [input])
  const platform = detectSourcePlatform(url)

  useEffect(() => () => {
    mountedRef.current = false
    activeController.current?.abort()
  }, [])

  const openDraft = async (draft: ImportedRecipeDraft, createdImages: string[] = [], signal?: ImportSignal): Promise<boolean> => {
    if (!mountedRef.current || signal?.aborted) {
      await deletePersistedImages(createdImages).catch(() => undefined)
      return false
    }
    let hadPreviousDraft = false
    let previousDraft: unknown = null
    try {
      hadPreviousDraft = hasStorageKeyStrict(STORAGE_KEYS.IMPORT_DRAFT)
      if (hadPreviousDraft) previousDraft = getStorageStrict<unknown>(STORAGE_KEYS.IMPORT_DRAFT, null)
    } catch {
      await deletePersistedImages(createdImages).catch(() => undefined)
      if (mountedRef.current) {
        setState('error')
        setMessage('无法读取当前浏览器中的旧草稿，已停止覆盖。')
      }
      return false
    }
    if (!setStorage(STORAGE_KEYS.IMPORT_DRAFT, draft)) {
      await deletePersistedImages(createdImages).catch(() => undefined)
      if (mountedRef.current) {
        setState('error')
        setMessage('导入内容无法保存到当前浏览器，请检查本地存储权限。')
      }
      return false
    }
    try {
      await Taro.navigateTo({ url: '/pages/recipe-edit/index?draft=1' })
      return true
    } catch {
      const restored = hadPreviousDraft
        ? setStorage(STORAGE_KEYS.IMPORT_DRAFT, previousDraft)
        : removeStorage(STORAGE_KEYS.IMPORT_DRAFT)
      if (restored) await deletePersistedImages(createdImages).catch(() => undefined)
      if (mountedRef.current) {
        setState('error')
        setMessage(restored
          ? '菜谱草稿已生成，但编辑页暂时无法打开，请重新尝试。'
          : '编辑页无法打开，且浏览器未能恢复旧草稿；新草稿仍保留在本机。')
      }
      return false
    }
  }

  const startImport = async () => {
    if (!url) return Taro.showToast({ title: '请粘贴菜谱链接', icon: 'none' })
    if (platform === 'unknown') {
      setState('error'); setMessage('目前只支持小红书、xhslink 和下厨房公开链接。')
      return
    }
    if (!serviceConfigured) {
      setState('error')
      setMessage('当前在线版是 GitHub Pages 静态网页，尚未连接菜谱解析服务。请先粘贴原文生成草稿，或转为详细录入。')
      return
    }
    if (!gatewayAccessReady) {
      setState('error')
      setMessage('请先填写解析服务访问码。')
      return
    }
    const controller = createImportController()
    activeController.current = controller
    const apiBase = getImportApiBase()
    const gatewayAccessKey = gatewayService ? accessKey.trim() : ''
    const startedAt = Date.now()
    setState('loading'); setMessage(''); setStepIndex(0); setProgress(8); setElapsedSeconds(0)
    const timer = setInterval(() => {
      const elapsed = Date.now() - startedAt
      const nextProgress = progressAt(elapsed)
      setElapsedSeconds(Math.floor(elapsed / 1000))
      setProgress(nextProgress)
      setStepIndex(stepAt(nextProgress))
    }, 250)
    const hardTimeout = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_MS)

    try {
      const result = await importRecipe(url, gatewayAccessKey, controller.signal)
      if (result.success) {
        clearTimeout(hardTimeout)
        clearInterval(timer)
        setProgress(96)
        setStepIndex(3)
        const persisted = await persistImportedDraftImages(result.data, controller.signal, { apiBase, accessKey: gatewayAccessKey })
        setProgress(100)
        if ((persisted.draft.warnings || []).length) Taro.showToast({ title: '部分内容需手工确认', icon: 'none' })
        if (activeController.current === controller) activeController.current = null
        await openDraft(persisted.draft, persisted.createdImages, controller.signal)
        return
      }
      if (result.partialData && Object.keys(result.partialData).length) {
        clearTimeout(hardTimeout)
        clearInterval(timer)
        const source = result.partialData.source || { platform, sourceUrl: url, importedAt: Date.now() }
        const draft = normalizeDraft({ ...result.partialData, source, warnings: [result.message] }, url)
        const persisted = await persistImportedDraftImages(draft, controller.signal, { apiBase, accessKey: gatewayAccessKey })
        setState('partial'); setMessage(result.message)
        if (activeController.current === controller) activeController.current = null
        await openDraft(persisted.draft, persisted.createdImages, controller.signal)
        return
      }
      setState('error'); setMessage(result.errorCode === 'CANCELLED' && Date.now() - startedAt >= IMPORT_TIMEOUT_MS - 500
        ? '读取超过 15 秒，已停止等待。可稍后重试或粘贴原文继续。'
        : result.message)
    } catch {
      setState('error')
      setMessage(controller.signal.aborted ? '已取消导入，没有保存任何菜谱内容。' : '图片保存阶段出现异常，可重新导入或粘贴原文继续。')
    } finally {
      clearInterval(timer)
      clearTimeout(hardTimeout)
      if (activeController.current === controller) activeController.current = null
    }
  }

  const cancelImport = () => activeController.current?.abort()

  const continueWithRaw = async () => {
    if (!rawContent.trim()) return Taro.showToast({ title: '请先粘贴原文', icon: 'none' })
    await openDraft(createManualDraft(url, rawContent))
  }

  return (
    <View className='pk-page import-page'>
      <View className='pk-title'>链接导入</View><View className='pk-subtitle'>支持小红书、xhslink 短链接和下厨房公开菜谱</View>
      {!serviceConfigured && <View className='service-notice pk-card'><View className='service-notice-title'>在线版暂未启用自动解析</View><View>GitHub Pages 只能运行静态网页，不能在后台读取小红书。你仍可在下方粘贴原文，数据会保存在当前浏览器。</View></View>}

      {gatewayService && <View className='gateway-access pk-card'><View className='field-title'>解析服务访问码</View><View className='gateway-help'>访问码只在当前页面内存中使用，刷新或关闭后会自动清除，不会写入浏览器存储。</View><Input className='pk-input' password value={accessKey} placeholder='粘贴访问码' onInput={(event) => setAccessKey(event.detail.value)} /></View>}

      <View className='import-card pk-card'><View className='field-title'>粘贴链接</View><Input className='pk-input' value={input} placeholder='https://...' onInput={(event) => setInput(event.detail.value)} /><View className={`platform-hint ${platform}`}>{url ? (platform === 'xiaohongshu' ? '已识别：小红书' : platform === 'xiachufang' ? '已识别：下厨房' : '暂不支持该链接') : '请仅导入你主动提供的公开链接'}</View><Button className='pk-primary import-button' loading={state === 'loading'} disabled={state === 'loading' || !serviceConfigured || !gatewayAccessReady} onClick={startImport}>{serviceConfigured ? gatewayAccessReady ? '开始导入' : '请先填写访问码' : '自动解析服务未启用'}</Button></View>

      {state === 'loading' && <View className='progress-card pk-card'><View className='progress-summary'><View><View className='progress-title'>正在导入菜谱</View><View className='progress-time'>已用时 {elapsedSeconds} 秒；解析最多 15 秒，图片保存另需最多 20 秒</View></View><View className='progress-percent'>{progress}%</View></View><View className='progress-track'><View className='progress-fill' style={{ width: `${progress}%` }} /></View><View className='progress-stage'>当前：{steps[stepIndex]}</View><View className='progress-steps'>{steps.map((text, index) => <View key={text} className={index === stepIndex ? 'is-current' : index < stepIndex ? 'is-done' : ''}><View className='progress-dot' /><View>{text}</View></View>)}</View><Button className='cancel-button' onClick={cancelImport}>取消导入</Button></View>}

      {state === 'error' && <View className='error-card pk-card'><View className='error-title'>当前链接无法自动解析</View><View className='error-message'>{message}</View><View className='safe-note'>不会尝试绕过登录、验证码、签名或平台访问限制。你仍可以粘贴原文生成草稿。</View><Button className='pk-secondary' onClick={startImport}>重新导入</Button></View>}

      <View className='fallback-card pk-card'><View className='field-title'>自动解析失败？粘贴原文继续</View><View className='fallback-help'>第一行可作为菜名；带“步骤1 / ① / 第一步”等编号时会自动拆分步骤。</View><Textarea className='pk-textarea raw-input' value={rawContent} maxlength={10000} placeholder='把公开内容的标题和正文粘贴到这里……' onInput={(event) => setRawContent(event.detail.value)} /><Button className='pk-secondary raw-button' onClick={continueWithRaw}>用原文生成草稿</Button><Button className='detail-button' onClick={() => Taro.redirectTo({ url: '/pages/recipe-edit/index' })}>转为详细录入</Button></View>
    </View>
  )
}
