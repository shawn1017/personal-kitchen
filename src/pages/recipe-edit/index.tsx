import { useEffect, useRef, useState } from 'react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { Button, Input, Picker, Switch, Text, Textarea, View } from '@tarojs/components'
import HeartMealIcon from '@/components/Icon'
import PersistedImage from '@/components/PersistedImage'
import { Category, ImportedRecipeDraft, Recipe, RecipeIngredient, RecipeSourceMeta, RecipeStep } from '@/types'
import { runWithConcurrency } from '@/utils/async'
import { getCategories } from '@/utils/categories'
import { chooseAndPersistImage, deletePersistedImages, isPersistedImageReference, persistImage, schedulePersistedImageGarbageCollection } from '@/utils/images'
import { createId } from '@/utils/id'
import { createRecipe, getRecipe, updateRecipe } from '@/utils/recipes'
import { STORAGE_KEYS, getStorage, removeStorage } from '@/utils/storage'
import './index.scss'

interface RecipeForm {
  name: string
  categoryId: string
  coverImage?: string
  galleryImages: string[]
  description: string
  tips: string
  enabled: boolean
  ingredients: RecipeIngredient[]
  steps: RecipeStep[]
  source: RecipeSourceMeta
}

const emptyForm: RecipeForm = {
  name: '', categoryId: '', galleryImages: [], description: '', tips: '', enabled: true,
  ingredients: [], steps: [], source: { platform: 'manual' }
}

function recipeToForm(recipe: Recipe): RecipeForm {
  return {
    name: recipe.name, categoryId: recipe.categoryId, coverImage: recipe.coverImage,
    galleryImages: recipe.galleryImages || [], description: recipe.description || '', tips: recipe.tips || '',
    enabled: recipe.enabled, ingredients: recipe.ingredients || [], steps: recipe.steps || [],
    source: recipe.source || { platform: 'manual' }
  }
}

function draftToForm(draft: ImportedRecipeDraft, categories: Category[]): RecipeForm {
  const category = categories.find((item) => item.name === draft.categorySuggestion) || categories[0]
  return {
    name: draft.title, categoryId: category?.id || '', coverImage: draft.coverImage,
    galleryImages: draft.galleryImages || [], description: draft.rawContent || '', tips: draft.tips || '', enabled: true,
    ingredients: draft.ingredients || [], steps: draft.steps || [], source: draft.source
  }
}

export default function RecipeEditPage() {
  const router = useRouter()
  const recipeId = String(router.params.id || '')
  const fromDraft = router.params.draft === '1'
  const [categories, setCategories] = useState<Category[]>([])
  const [form, setForm] = useState<RecipeForm>(emptyForm)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [imagePending, setImagePending] = useState(false)
  const imagePendingRef = useRef(false)
  const mountedRef = useRef(true)
  const imageSaveControllerRef = useRef<AbortController | null>(null)
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [ingredientsOpen, setIngredientsOpen] = useState(true)
  const [stepsOpen, setStepsOpen] = useState(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      const saveWasActive = imageSaveControllerRef.current !== null
      mountedRef.current = false
      imagePendingRef.current = false
      imageSaveControllerRef.current?.abort()
      imageSaveControllerRef.current = null
      if (redirectTimerRef.current !== null) clearTimeout(redirectTimerRef.current)
      redirectTimerRef.current = null
      if (saveWasActive) Taro.hideLoading()
    }
  }, [])

  useDidShow(() => {
    if (!mountedRef.current || loaded) return
    const nextCategories = getCategories().filter((item) => item.enabled)
    setCategories(nextCategories)
    if (recipeId) {
      const recipe = getRecipe(recipeId)
      if (recipe) setForm(recipeToForm(recipe))
    } else if (fromDraft) {
      const draft = getStorage<ImportedRecipeDraft | null>(STORAGE_KEYS.IMPORT_DRAFT, null)
      if (draft) setForm(draftToForm(draft, nextCategories))
    } else {
      setForm({ ...emptyForm, categoryId: nextCategories[0]?.id || '', source: { platform: 'manual' } })
    }
    setLoaded(true)
  })

  const patchForm = (patch: Partial<RecipeForm>) => {
    if (!mountedRef.current || saving) return
    setForm((current) => ({ ...current, ...patch }))
  }
  const updateIngredient = (index: number, patch: Partial<RecipeIngredient>) => patchForm({ ingredients: form.ingredients.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) })
  const updateStep = (index: number, patch: Partial<RecipeStep>) => patchForm({ steps: form.steps.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) })
  const move = <T,>(items: T[], index: number, direction: -1 | 1): T[] => {
    const target = index + direction
    if (target < 0 || target >= items.length) return items
    const next = items.slice(); const current = next[index]; next[index] = next[target]; next[target] = current
    return next
  }

  const selectAndApplyImage = async (apply: (image: string) => void) => {
    if (!mountedRef.current || imagePendingRef.current || saving) return
    imagePendingRef.current = true
    setImagePending(true)
    try {
      const image = await chooseAndPersistImage()
      if (!mountedRef.current) return
      if (!image) return Taro.showToast({ title: '图片保存失败，请选择 4 MB 内的图片', icon: 'none' })
      apply(image)
    } catch {
      if (mountedRef.current) Taro.showToast({ title: '图片选择或保存失败', icon: 'none' })
    } finally {
      imagePendingRef.current = false
      if (mountedRef.current) setImagePending(false)
    }
  }
  const chooseCover = async () => selectAndApplyImage((image) => setForm((current) => ({ ...current, coverImage: image })))
  const addGalleryImage = async () => selectAndApplyImage((image) => setForm((current) => ({ ...current, galleryImages: current.galleryImages.concat(image) })))
  const chooseStepImage = async (index: number) => {
    const stepId = form.steps[index]?.id
    if (!stepId) return
    await selectAndApplyImage((image) => setForm((current) => ({
      ...current,
      steps: current.steps.map((step) => step.id === stepId ? { ...step, image } : step)
    })))
  }

  const save = async () => {
    if (!mountedRef.current) return
    const formSnapshot = form
    const name = formSnapshot.name.trim()
    if (!name) return Taro.showToast({ title: '请填写菜谱名称', icon: 'none' })
    if (!formSnapshot.categoryId) return Taro.showToast({ title: '请选择所属分类', icon: 'none' })
    if (imagePendingRef.current) return Taro.showToast({ title: '图片正在保存，请稍候', icon: 'none' })
    if (saving || imageSaveControllerRef.current) return
    setSaving(true)
    Taro.showLoading({ title: '正在保存' })
    const imageSaveController = new AbortController()
    imageSaveControllerRef.current = imageSaveController
    const imageSaveTimeout = setTimeout(() => imageSaveController.abort(), 30_000)
    const createdImages = new Set<string>()
    let committed = false
    try {
      const persistedImages = new Map<string, Promise<string>>()
      const persistTracked = (path: string): Promise<string> => {
        let pending = persistedImages.get(path)
        if (!pending) {
          pending = persistImage(path, imageSaveController.signal).then((saved) => {
            if (!saved || (/^https?:\/\//i.test(path) && saved === path)) {
              throw new Error('图片没有成功保存到本机')
            }
            if (saved !== path && isPersistedImageReference(saved)) createdImages.add(saved)
            return saved
          })
          persistedImages.set(path, pending)
        }
        return pending
      }
      const imagePaths = [formSnapshot.coverImage, ...formSnapshot.galleryImages, ...formSnapshot.steps.map((step) => step.image)].filter((path): path is string => Boolean(path))
      await runWithConcurrency(Array.from(new Set(imagePaths)), 3, async (path) => { await persistTracked(path) })
      if (imageSaveController.signal.aborted) {
        throw imageSaveController.signal.reason instanceof Error
          ? imageSaveController.signal.reason
          : new DOMException('Aborted', 'AbortError')
      }
      clearTimeout(imageSaveTimeout)
      const coverImage = formSnapshot.coverImage ? (await persistTracked(formSnapshot.coverImage) || undefined) : undefined
      const galleryImages = (await Promise.all(formSnapshot.galleryImages.map(persistTracked))).filter(Boolean)
      const steps = await Promise.all(formSnapshot.steps.map(async (step, index) => ({ ...step, sort: index, image: step.image ? (await persistTracked(step.image) || undefined) : undefined })))
      const input = {
        name, categoryId: formSnapshot.categoryId, coverImage, galleryImages,
        description: formSnapshot.description.trim(), tips: formSnapshot.tips.trim(), enabled: formSnapshot.enabled,
        ingredients: formSnapshot.ingredients.filter((item) => item.name.trim()).map((item, index) => ({ ...item, name: item.name.trim(), sort: index })),
        steps: steps.filter((item) => item.text.trim() || item.image).map((item, index) => ({ ...item, sort: index })),
        source: { ...formSnapshot.source, sourceUrl: formSnapshot.source.sourceUrl?.trim() }
      }
      if (!mountedRef.current || imageSaveController.signal.aborted) {
        throw imageSaveController.signal.reason instanceof Error
          ? imageSaveController.signal.reason
          : new DOMException('Aborted', 'AbortError')
      }
      if (recipeId) {
        const updated = updateRecipe(recipeId, input)
        if (!updated) throw new Error('菜谱已不存在')
      } else createRecipe(input)
      committed = true
    } catch {
      const imageSaveTimedOut = imageSaveController.signal.aborted
      imageSaveController.abort()
      if (!committed) await deletePersistedImages(createdImages).catch(() => undefined)
      if (mountedRef.current) {
        Taro.hideLoading()
        Taro.showToast({ title: imageSaveTimedOut ? '图片保存超时，请重试' : '保存失败，请检查图片或存储空间', icon: 'none' })
        setSaving(false)
      }
      return
    } finally {
      clearTimeout(imageSaveTimeout)
      if (imageSaveControllerRef.current === imageSaveController) imageSaveControllerRef.current = null
    }
    if (!mountedRef.current) return
    if (fromDraft) removeStorage(STORAGE_KEYS.IMPORT_DRAFT)
    schedulePersistedImageGarbageCollection()
    Taro.hideLoading()
    Taro.showToast({ title: recipeId ? '菜谱已修改' : '菜谱已保存', icon: 'success' })
    if (!mountedRef.current) return
    redirectTimerRef.current = setTimeout(() => {
      redirectTimerRef.current = null
      if (mountedRef.current) Taro.redirectTo({ url: '/pages/recipe-manage/index' })
    }, 450)
  }

  const categoryIndex = Math.max(0, categories.findIndex((item) => item.id === form.categoryId))
  const visibleGalleryImages = form.galleryImages
    .map((image, index) => ({ image, index }))
    .filter((item) => item.image !== form.coverImage)

  if (!loaded) return <View className='pk-page edit-page edit-loading'>正在准备菜谱…</View>

  return (
    <View className='pk-page edit-page'>
      <View className='edit-heading'><View className='pk-title'>{recipeId ? '修改菜谱' : '新建菜谱'}</View><View className='pk-subtitle'>保存后会同步刷新厨房</View></View>
      <View className='edit-section pk-card'>
        <View className='section-title'>封面</View>
        <View className='cover-editor'>
          <View className='edit-cover-wrap'>
            {form.coverImage ? <PersistedImage className='edit-cover' src={form.coverImage} mode='aspectFill' /> : <View className='edit-cover pk-cover-fallback'>封面</View>}
            {form.coverImage && <Button className='remove-cover' onClick={() => patchForm({ coverImage: undefined })}><HeartMealIcon name='delete' size='sm' /></Button>}
            {form.coverImage && <View className='cover-label'>当前封面</View>}
          </View>
          <Button className='cover-upload' disabled={imagePending || saving} onClick={chooseCover}><HeartMealIcon name='image' size='lg' /><Text>{imagePending ? '图片保存中' : '上传图片'}</Text></Button>
        </View>
        <View className='cover-actions'><Button disabled={imagePending || saving} onClick={addGalleryImage}><HeartMealIcon name='plus' size='sm' />加入图库</Button>{visibleGalleryImages.length > 0 && <View>点击下方图片即可设为封面</View>}</View>
        {visibleGalleryImages.length > 0 && <View className='gallery-strip'>{visibleGalleryImages.map(({ image, index }) => <View key={`${image}_${index}`} className='gallery-item'><PersistedImage src={image} mode='aspectFill' onClick={() => patchForm({ coverImage: image })} /><Button onClick={() => patchForm({ galleryImages: form.galleryImages.filter((_, itemIndex) => itemIndex !== index) })}><HeartMealIcon name='delete' size='sm' /></Button></View>)}</View>}
      </View>

      <View className='edit-section pk-card recipe-copy-section'><View className='field-label'>菜谱名称 *</View><Input className='pk-input recipe-name-input' value={form.name} maxlength={50} placeholder='例如：啤酒鸭' onInput={(event) => patchForm({ name: event.detail.value })} /><View className='field-label'>原始文案 / 菜谱介绍</View><Textarea className='pk-textarea tall raw-content' value={form.description} maxlength={5000} placeholder='介绍这道菜，导入内容的原始正文也会放在这里' onInput={(event) => patchForm({ description: event.detail.value })} /></View>

      <View className='edit-section pk-card'>
        <View className='field-row'><View><View className='field-label no-margin'>所属分类 *</View><View className='field-help'>导入建议仅供参考，以你的选择为准</View></View><Picker mode='selector' range={categories.map((item) => item.name)} value={categoryIndex} onChange={(event) => patchForm({ categoryId: categories[Number(event.detail.value)]?.id || form.categoryId })}><View className='picker-value'>{categories[categoryIndex]?.name || '请选择'}</View></Picker></View>
        <View className='field-row enabled-row'><View><View className='field-label no-margin'>厨房上架</View><View className='field-help'>关闭后只在管理页保留</View></View><Switch checked={form.enabled} color='#4CAF50' onChange={(event) => patchForm({ enabled: event.detail.value })} /></View>
      </View>

      <View className='edit-section pk-card'>
        <View className='section-head'><View className='section-heading'><HeartMealIcon name='cart' size='md' /><View className='section-title'>用料</View></View><View className='section-head-actions'><Button className='section-toggle' onClick={() => setIngredientsOpen(!ingredientsOpen)}>{ingredientsOpen ? '收起' : '展开'}</Button><Button className='mini-add' onClick={() => { setIngredientsOpen(true); patchForm({ ingredients: form.ingredients.concat({ id: createId('ingredient'), name: '', amount: '', unit: '', remark: '', sort: form.ingredients.length }) }) }}><HeartMealIcon name='plus' size='sm' />新增</Button></View></View>
        {ingredientsOpen && !form.ingredients.length && <View className='inline-empty'>还没有用料，点击“新增”添加</View>}
        {ingredientsOpen && form.ingredients.map((item, index) => <View key={item.id} className='ingredient-editor'>
          <View className='editor-index'>{index + 1}</View><Input value={item.name} placeholder='名称' onInput={(event) => updateIngredient(index, { name: event.detail.value })} /><Input value={item.amount} placeholder='数量' onInput={(event) => updateIngredient(index, { amount: event.detail.value })} /><Input value={item.unit} placeholder='单位' onInput={(event) => updateIngredient(index, { unit: event.detail.value })} />
          <Input className='remark-field' value={item.remark} placeholder='备注（可选）' onInput={(event) => updateIngredient(index, { remark: event.detail.value })} />
          <View className='editor-actions'><Button disabled={index === 0} onClick={() => patchForm({ ingredients: move(form.ingredients, index, -1) })}>上移</Button><Button disabled={index === form.ingredients.length - 1} onClick={() => patchForm({ ingredients: move(form.ingredients, index, 1) })}>下移</Button><Button className='danger' onClick={() => patchForm({ ingredients: form.ingredients.filter((_, itemIndex) => itemIndex !== index) })}>删除</Button></View>
        </View>)}
      </View>

      <View className='edit-section pk-card'>
        <View className='section-head'><View className='section-heading'><HeartMealIcon name='note' size='md' /><View className='section-title'>做法步骤</View></View><View className='section-head-actions'><Button className='section-toggle' onClick={() => setStepsOpen(!stepsOpen)}>{stepsOpen ? '收起' : '展开'}</Button><Button className='mini-add' onClick={() => { setStepsOpen(true); patchForm({ steps: form.steps.concat({ id: createId('step'), text: '', sort: form.steps.length }) }) }}><HeartMealIcon name='plus' size='sm' />新增一步</Button></View></View>
        {stepsOpen && !form.steps.length && <View className='inline-empty'>还没有步骤，可以逐步补充说明和图片</View>}
        {stepsOpen && form.steps.map((step, index) => <View key={step.id} className='step-editor'>
          <View className='step-editor-title'><View className='editor-index'>{index + 1}</View><Text>步骤 {index + 1}</Text><View className='editor-actions'><Button disabled={index === 0} onClick={() => patchForm({ steps: move(form.steps, index, -1) })}>上移</Button><Button disabled={index === form.steps.length - 1} onClick={() => patchForm({ steps: move(form.steps, index, 1) })}>下移</Button><Button className='danger' onClick={() => patchForm({ steps: form.steps.filter((_, itemIndex) => itemIndex !== index) })}>删除</Button></View></View>
          {step.image ? <PersistedImage className='step-edit-image' src={step.image} mode='aspectFill' onClick={() => chooseStepImage(index)} /> : <Button className='step-image-button' disabled={imagePending || saving} onClick={() => chooseStepImage(index)}><HeartMealIcon name='image' size='md' />添加步骤图片</Button>}
          <Textarea className='pk-textarea' value={step.text} maxlength={1000} placeholder='写下这一步怎么做' onInput={(event) => updateStep(index, { text: event.detail.value })} />
          <View className='timer-row'><View><HeartMealIcon name='clock' size='sm' /><Text>计时（分钟，可选）</Text></View><Input type='number' value={step.timerSeconds ? String(Math.round(step.timerSeconds / 60)) : ''} placeholder='0' onInput={(event) => updateStep(index, { timerSeconds: Math.max(0, Number(event.detail.value || 0)) * 60 || undefined })} /></View>
        </View>)}
      </View>

      <View className='edit-section pk-card'><View className='section-title'>烹饪经验</View><Textarea className='pk-textarea' value={form.tips} maxlength={2000} placeholder='火候、替换食材、注意事项……' onInput={(event) => patchForm({ tips: event.detail.value })} /></View>

      <View className='edit-section pk-card advanced-section'><View className='advanced-toggle' onClick={() => setAdvancedOpen(!advancedOpen)}><View className='section-title'>高级设置 / 来源信息</View><Text>{advancedOpen ? '收起' : '展开'}</Text></View>{advancedOpen && <View className='advanced-body'><View className='source-line'>来源平台：{form.source.platform}</View>{form.source.authorName && <View className='source-line'>作者：{form.source.authorName}</View>}<View className='field-label'>原始链接</View><Input className='pk-input' value={form.source.sourceUrl || ''} placeholder='https://...' onInput={(event) => patchForm({ source: { ...form.source, sourceUrl: event.detail.value } })} />{form.source.importedAt && <View className='source-line'>导入时间：{new Date(form.source.importedAt).toLocaleString('zh-CN')}</View>}</View>}</View>

      <View className='save-bar'><Button className='pk-primary' loading={saving} disabled={imagePending || saving} onClick={save}>{imagePending ? '图片保存中…' : recipeId ? '修改菜谱' : '保存菜谱'}</Button></View>
    </View>
  )
}
