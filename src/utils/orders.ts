import { CartItem, Order } from '@/types'
import { clearCart, getCart, saveCart } from './cart'
import { createId } from './id'
import { ensureDataInitialized } from './migrations'
import { getRecipes } from './recipes'
import { STORAGE_KEYS, getStorage, setStorage } from './storage'

function normalizeOrders(value: unknown): Order[] {
  if (!Array.isArray(value)) return []
  return value.map((value): Order | null => {
    const order = value as Partial<Order>
    if (!order || !Array.isArray(order.items)) return null
    const items = order.items.map((value): Order['items'][number] | null => {
      const item = value as Order['items'][number]
      if (!item || typeof item.recipeId !== 'string' || typeof item.recipeName !== 'string') return null
      const quantity = Number(item.quantity)
      return {
        recipeId: item.recipeId,
        recipeName: item.recipeName,
        recipeImage: typeof item.recipeImage === 'string' ? item.recipeImage : undefined,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1
      }
    }).filter((item): item is Order['items'][number] => Boolean(item))
    if (!items.length) return null
    const createdAt = Number(order.createdAt)
    return {
      id: String(order.id || createId('order')),
      items,
      note: typeof order.note === 'string' ? order.note : '',
      status: order.status === 'completed' ? 'completed' as const : 'pending' as const,
      createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
      completedAt: Number(order.completedAt) > 0 ? Number(order.completedAt) : undefined
    }
  }).filter((order): order is Order => Boolean(order))
}

export function getOrders(): Order[] {
  ensureDataInitialized()
  return normalizeOrders(getStorage<unknown>(STORAGE_KEYS.ORDERS, [])).sort((a, b) => b.createdAt - a.createdAt)
}

export function saveOrders(orders: Order[]): void {
  if (!setStorage(STORAGE_KEYS.ORDERS, normalizeOrders(orders))) throw new Error('订单存储失败')
}

export function createOrder(note = ''): Order | null {
  const cart = getCart()
  const recipes = getRecipes()
  const items = cart.map((item) => {
    const recipe = recipes.find((candidate) => candidate.id === item.recipeId)
    if (!recipe) return null
    return { recipeId: recipe.id, recipeName: recipe.name, recipeImage: recipe.coverImage, quantity: item.quantity }
  }).filter((item): item is NonNullable<typeof item> => Boolean(item))
  if (!items.length) return null
  const order: Order = { id: createId('order'), items, note: note.trim(), status: 'pending', createdAt: Date.now() }
  saveOrders([order].concat(getOrders()))
  clearCart()
  return order
}

export function completeOrder(id: string): Order[] {
  const orders = getOrders().map((item) => item.id === id
    ? { ...item, status: 'completed' as const, completedAt: Date.now() }
    : item)
  saveOrders(orders)
  return orders
}

export function reorder(order: Order): CartItem[] {
  const current = getCart().map((item) => ({ ...item }))
  const recipeIds = new Set(getRecipes().map((recipe) => recipe.id))
  order.items.forEach((orderItem) => {
    if (!recipeIds.has(orderItem.recipeId)) return
    const existed = current.find((item) => item.recipeId === orderItem.recipeId)
    if (existed) existed.quantity += orderItem.quantity
    else current.push({ recipeId: orderItem.recipeId, quantity: orderItem.quantity })
  })
  return saveCart(current)
}
