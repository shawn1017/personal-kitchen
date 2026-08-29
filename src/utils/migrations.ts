import { seedCategories, seedRecipes } from '@/data/seed'
import { CartItem, Order, Recipe } from '@/types'
import { STORAGE_KEYS, getStorage, hasStorageKey, setStorage } from './storage'

const CURRENT_SCHEMA_VERSION = 2

interface LegacyCartItem {
  dishId?: number
  name?: string
  cover?: string
  count?: number
}

interface LegacyOrder {
  orderId?: string
  createTime?: string
  items?: LegacyCartItem[]
  remark?: string
}

export function migrateLegacyCart(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return []
  return value.map((candidate) => {
    const item = candidate as LegacyCartItem
    const recipe = seedRecipes.find((seed) => seed.name === item.name)
    if (!recipe || Number(item.count) <= 0) return null
    return { recipeId: recipe.id, quantity: Number(item.count) }
  }).filter((item): item is CartItem => Boolean(item))
}

export function migrateLegacyOrders(value: unknown): Order[] {
  if (!Array.isArray(value)) return []
  return value.map((candidate, orderIndex): Order | null => {
    const legacy = candidate as LegacyOrder
    if (!Array.isArray(legacy.items)) return null
    const items = legacy.items.map((candidate, itemIndex): Order['items'][number] | null => {
      const item = candidate as LegacyCartItem
      if (!item.name || Number(item.count) <= 0) return null
      return {
        recipeId: `legacy_${item.dishId || itemIndex + 1}`,
        recipeName: item.name,
        recipeImage: typeof item.cover === 'string' ? item.cover : undefined,
        quantity: Number(item.count)
      }
    }).filter((item): item is Order['items'][number] => Boolean(item))
    if (!items.length) return null
    const parsedTime = legacy.createTime ? new Date(legacy.createTime).getTime() : 0
    const createdAt = Number.isFinite(parsedTime) && parsedTime > 0 ? parsedTime : Date.now() - orderIndex
    return {
      id: legacy.orderId || `legacy_order_${createdAt}_${orderIndex}`,
      items,
      note: legacy.remark || '',
      status: 'completed',
      createdAt,
      completedAt: createdAt
    }
  }).filter((order): order is Order => Boolean(order))
}

export function ensureDataInitialized(): void {
  const version = Number(getStorage(STORAGE_KEYS.SCHEMA_VERSION, 0))
  if (version >= CURRENT_SCHEMA_VERSION) return
  if (!hasStorageKey(STORAGE_KEYS.CATEGORIES)) setStorage(STORAGE_KEYS.CATEGORIES, seedCategories)
  if (!hasStorageKey(STORAGE_KEYS.RECIPES)) setStorage(STORAGE_KEYS.RECIPES, seedRecipes)
  if (!hasStorageKey(STORAGE_KEYS.CART)) setStorage(STORAGE_KEYS.CART, migrateLegacyCart(getStorage<unknown>('cart', [])))
  if (!hasStorageKey(STORAGE_KEYS.ORDERS)) setStorage(STORAGE_KEYS.ORDERS, migrateLegacyOrders(getStorage<unknown>('orders', [])))
  if (!hasStorageKey(STORAGE_KEYS.SETTINGS)) setStorage(STORAGE_KEYS.SETTINGS, {})
  if (version < 2 && hasStorageKey(STORAGE_KEYS.RECIPES)) {
    const recipes = getStorage<Recipe[]>(STORAGE_KEYS.RECIPES, [])
    setStorage(STORAGE_KEYS.RECIPES, recipes.map((recipe) => {
      const seed = seedRecipes.find((item) => item.id === recipe.id)
      if (!seed) return recipe
      return {
        ...recipe,
        coverImage: recipe.coverImage || seed.coverImage,
        galleryImages: recipe.galleryImages?.length ? recipe.galleryImages : seed.galleryImages,
        steps: recipe.steps.map((step, index) => index === 0 && !step.image
          ? { ...step, image: seed.steps[0]?.image }
          : step)
      }
    }))
  }
  setStorage(STORAGE_KEYS.SCHEMA_VERSION, CURRENT_SCHEMA_VERSION)
}
