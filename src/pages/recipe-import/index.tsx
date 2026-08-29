import { useMemo, useState } from 'react'
import Taro from '@tarojs/taro'
import { Button, Input, Textarea, View } from '@tarojs/components'
import { ImportedRecipeDraft } from '@/types'
import { createManualDraft, detectSourcePlatform, importRecipe } from '@/services/importRecipe'
import { normalizeDraft } from '@/utils/recipeNormalizer'
import { STORAGE_KEYS, setStorage } from '@/utils/storage'
import './index.scss'

type ImportState = 'idle' | 'loading' | 'error' | 'partial'
const steps = ['正在识别来源…', '正在读取标题和正文…', '正在整理图片…', '正在生成菜谱草稿…']

function extractUrl(value: string): string {
  return value.match(/https?:\/\/[^\s]+/i)?.[0] || value.trim()
}

export default function RecipeImportPage() {
  const [input, setInput] = useState('')
  const [rawContent, setRawContent] = useState('')
  const [state, setState] = useState<ImportState>('idle')
  const [message, setMessage] = useState('')
  const [stepIndex, setStepIndex] = useState(0)
  const url = useMemo(() => extractUrl(input), [input])
  const platform = detectSourcePlatform(url)

  const openDraft = (draft: ImportedRecipeDraft) => {
    setStorage(STORAGE_KEYS.IMPORT_DRAFT, draft)
    Taro.navigateTo({ url: '/pages/recipe-edit/index?draft=1' })
  }

  const startImport = async () => {
    if (!url) return Taro.showToast({ title: '请粘贴菜谱链接', icon: 'none' })
    if (platform === 'unknown') {
      setState('error'); setMessage('目前只支持小红书、xhslink 和下厨房公开链接。')
      return
    }
    setState('loading'); setMessage(''); setStepIndex(0)
    const timer = setInterval(() => setStepIndex((current) => Math.min(current + 1, steps.length - 1)), 1100)
    const result = await importRecipe(url)
    clearInterval(timer)
    if (result.success) {
      if (result.warnings.length) Taro.showToast({ title: '部分内容需手工确认', icon: 'none' })
      openDraft(result.data)
      return
    }
    if (result.partialData && Object.keys(result.partialData).length) {
      const source = result.partialData.source || { platform, sourceUrl: url, importedAt: Date.now() }
      const draft = normalizeDraft({ ...result.partialData, source, warnings: [result.message] }, url)
      setState('partial'); setMessage(result.message)
      openDraft(draft)
      return
    }
    setState('error'); setMessage(result.message)
  }

  const continueWithRaw = () => {
    if (!rawContent.trim()) return Taro.showToast({ title: '请先粘贴原文', icon: 'none' })
    openDraft(createManualDraft(url, rawContent))
  }

  return (
    <View className='pk-page import-page'>
      <View className='pk-title'>链接导入</View><View className='pk-subtitle'>支持小红书、xhslink 短链接和下厨房公开菜谱</View>
      <View className='import-card pk-card'><View className='field-title'>粘贴链接</View><Input className='pk-input' value={input} placeholder='https://...' onInput={(event) => setInput(event.detail.value)} /><View className={`platform-hint ${platform}`}>{url ? (platform === 'xiaohongshu' ? '已识别：小红书' : platform === 'xiachufang' ? '已识别：下厨房' : '暂不支持该链接') : '请仅导入你主动提供的公开链接'}</View><Button className='pk-primary import-button' loading={state === 'loading'} disabled={state === 'loading'} onClick={startImport}>开始导入</Button></View>

      {state === 'loading' && <View className='progress-card pk-card'>{steps.map((text, index) => <View key={text} className={index === stepIndex ? 'is-current' : index < stepIndex ? 'is-done' : ''}><View className='progress-dot' /><View>{text}</View></View>)}</View>}

      {state === 'error' && <View className='error-card pk-card'><View className='error-title'>当前链接无法自动解析</View><View className='error-message'>{message}</View><View className='safe-note'>不会尝试绕过登录、验证码、签名或平台访问限制。你仍可以粘贴原文生成草稿。</View><Button className='pk-secondary' onClick={startImport}>重新导入</Button></View>}

      <View className='fallback-card pk-card'><View className='field-title'>自动解析失败？粘贴原文继续</View><View className='fallback-help'>第一行可作为菜名；带“步骤1 / ① / 第一步”等编号时会自动拆分步骤。</View><Textarea className='pk-textarea raw-input' value={rawContent} maxlength={10000} placeholder='把公开内容的标题和正文粘贴到这里……' onInput={(event) => setRawContent(event.detail.value)} /><Button className='pk-secondary raw-button' onClick={continueWithRaw}>用原文生成草稿</Button><Button className='detail-button' onClick={() => Taro.redirectTo({ url: '/pages/recipe-edit/index' })}>转为详细录入</Button></View>
    </View>
  )
}
