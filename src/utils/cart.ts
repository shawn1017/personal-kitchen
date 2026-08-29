import { CartItem, CartItemView, Recipe } from '@/types'
import { ensureDataInitialized } from './migrations'
import { getRecipes } from './recipes'
import { STORAGE_KEYS, getStorage, setStorage } from './storage'

function normalizeCart(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const candidate = item as Partial<CartItem>
    return { recipeId: String(candidate.recipeId || ''), quantity: Math.max(0, Number(candidate.quantity || 0)) }
  }).filter((item) => item.recipeId && item.quantity > 0)
}
export function getCart(): CartItem[] {
  ensureDataInitialized()
  return normalizeCart(getStorage<unknown>(STORAGE_KEYS.CART, []))
}

export function saveCart(cart: CartItem[]): CartItem[] {
  const normalized = normalizeCart(cart)
  if (setStorage(STORAGE_KEYS.CART, normalized)) return normalized
  return normalizeCart(getStorage<unknown>(STORAGE_KEYS.CART, []))
}

export function addRecipeToCart(recipe: Recipe, currentCart = getCart()): CartItem[] {
  const next = currentCart.map((item) => ({ ...item }))
  const existed = next.find((item) => item.recipeId === recipe.id)
  if (existed) existed.quantity += 1
  else next.push({ recipeId: recipe.id, quantity: 1 })
  return saveCart(next)
}

export function updateCartItemQuantity(recipeId: string, delta: number, currentCart = getCart()): CartItem[] {
  return saveCart(currentCart.map((item) => item.recipeId === recipeId
    ? { ...item, quantity: item.quantity + delta }
    : item).filter((item) => item.quantity > 0))
}

export function removeCartItem(recipeId: string): CartItem[] {
  return saveCart(getCart().filter((item) => item.recipeId !== recipeId))
}

export function clearCart(): void {
  setStorage(STORAGE_KEYS.CART, [])
}

export function calcTotalCount(items = getCart()): number {
  return normalizeCart(items).reduce((sum, item) => sum + item.quantity, 0)
}

export function getCartView(): CartItemView[] {
  const recipes = getRecipes()
  const cart = getCart()
  const validCart = cart.filter((item) => recipes.some((recipe) => recipe.id === item.recipeId))
  if (validCart.length !== cart.length) saveCart(validCart)
  return validCart.map((item) => ({ ...item, recipe: recipes.find((recipe) => recipe.id === item.recipeId) }))
}
