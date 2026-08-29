import { Recipe, RecipeIngredient, RecipeSourceMeta, RecipeStep } from '@/types'
import { createId } from './id'
import { ensureDataInitialized } from './migrations'
import { STORAGE_KEYS, getStorage, setStorage } from './storage'

function normalizeRecipe(value: unknown, index: number): Recipe | null {
  const item = value as Partial<Recipe>
  if (!item || typeof item.name !== 'string' || !item.name.trim()) return null
  const now = Date.now()
  const ingredients = (Array.isArray(item.ingredients) ? item.ingredients : []).map((value, ingredientIndex): RecipeIngredient | null => {
    const ingredient = value as Partial<RecipeIngredient>
    if (!ingredient || typeof ingredient.name !== 'string' || !ingredient.name.trim()) return null
    return {
      id: String(ingredient.id || createId('ingredient')),
      name: ingredient.name.trim(),
      amount: typeof ingredient.amount === 'string' ? ingredient.amount : '',
      unit: typeof ingredient.unit === 'string' ? ingredient.unit : '',
      remark: typeof ingredient.remark === 'string' ? ingredient.remark : '',
      sort: Number.isFinite(Number(ingredient.sort)) ? Number(ingredient.sort) : ingredientIndex
    }
  }).filter((ingredient): ingredient is RecipeIngredient => Boolean(ingredient)).sort((a, b) => a.sort - b.sort)
  const steps = (Array.isArray(item.steps) ? item.steps : []).map((value, stepIndex): RecipeStep | null => {
    const step = value as Partial<RecipeStep>
    if (!step || (typeof step.text !== 'string' && typeof step.image !== 'string')) return null
    return {
      id: String(step.id || createId('step')),
      text: typeof step.text === 'string' ? step.text : '',
      image: typeof step.image === 'string' ? step.image : undefined,
      timerSeconds: Number(step.timerSeconds) > 0 ? Number(step.timerSeconds) : undefined,
      sort: Number.isFinite(Number(step.sort)) ? Number(step.sort) : stepIndex
    }
  }).filter((step): step is RecipeStep => Boolean(step)).sort((a, b) => a.sort - b.sort)
  const sourceValue = item.source as Partial<RecipeSourceMeta> | undefined
  const source: RecipeSourceMeta = sourceValue && ['xiaohongshu', 'xiachufang', 'manual'].includes(String(sourceValue.platform))
    ? { ...sourceValue, platform: sourceValue.platform as RecipeSourceMeta['platform'] }
    : { platform: 'manual' }
  const createdAt = Number(item.createdAt)
  const updatedAt = Number(item.updatedAt)
  return {
    id: String(item.id || createId('recipe')),
    name: item.name.trim(),
    categoryId: String(item.categoryId || ''),
    coverImage: typeof item.coverImage === 'string' ? item.coverImage : undefined,
    galleryImages: Array.isArray(item.galleryImages) ? item.galleryImages.filter((url): url is string => typeof url === 'string') : [],
    description: typeof item.description === 'string' ? item.description : '',
    tips: typeof item.tips === 'string' ? item.tips : '',
    enabled: item.enabled !== false,
    sort: Number.isFinite(Number(item.sort)) ? Number(item.sort) : index,
    ingredients,
    steps,
    source,
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : now,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : now
  }
}

export function getRecipes(): Recipe[] {
  ensureDataInitialized()
  const raw = getStorage<unknown>(STORAGE_KEYS.RECIPES, [])
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeRecipe).filter((item): item is Recipe => Boolean(item)).sort((a, b) => a.sort - b.sort)
}

export function saveRecipes(recipes: Recipe[]): void {
  const saved = setStorage(STORAGE_KEYS.RECIPES, recipes.map((item, index) => ({ ...item, sort: index })))
  if (!saved) throw new Error('菜谱存储失败')
}

export function getRecipe(id: string): Recipe | undefined {
  return getRecipes().find((item) => item.id === id)
}

export function createRecipe(input: Omit<Recipe, 'id' | 'createdAt' | 'updatedAt' | 'sort'>): Recipe {
  const recipes = getRecipes()
  const now = Date.now()
  const recipe: Recipe = { ...input, id: createId('recipe'), sort: recipes.length, createdAt: now, updatedAt: now }
  saveRecipes(recipes.concat(recipe))
  return recipe
}

export function updateRecipe(id: string, patch: Partial<Recipe>): Recipe | undefined {
  let updated: Recipe | undefined
  const recipes = getRecipes().map((item) => {
    if (item.id !== id) return item
    updated = { ...item, ...patch, id: item.id, createdAt: item.createdAt, updatedAt: Date.now() }
    return updated
  })
  saveRecipes(recipes)
  return updated
}

export function deleteRecipe(id: string): Recipe[] {
  const recipes = getRecipes().filter((item) => item.id !== id)
  saveRecipes(recipes)
  return recipes
}

export function moveRecipe(id: string, direction: -1 | 1): Recipe[] {
  const recipes = getRecipes()
  const index = recipes.findIndex((item) => item.id === id)
  const nextIndex = index + direction
  if (index < 0 || nextIndex < 0 || nextIndex >= recipes.length) return recipes
  const next = recipes.slice()
  const current = next[index]
  next[index] = next[nextIndex]
  next[nextIndex] = current
  saveRecipes(next)
  return next
}

export function setAllRecipesEnabled(enabled: boolean): Recipe[] {
  const now = Date.now()
  const recipes = getRecipes().map((item) => ({ ...item, enabled, updatedAt: now }))
  saveRecipes(recipes)
  return recipes
}
