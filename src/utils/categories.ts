import { Category } from '@/types'
import { createId } from './id'
import { ensureDataInitialized } from './migrations'
import { STORAGE_KEYS, getStorage, setStorage } from './storage'

function normalizeCategory(value: unknown, index: number): Category | null {
  const item = value as Partial<Category>
  if (!item || typeof item.name !== 'string' || !item.name.trim()) return null
  const now = Date.now()
  const createdAt = Number(item.createdAt)
  const updatedAt = Number(item.updatedAt)
  return {
    id: String(item.id || createId('category')),
    name: item.name.trim(),
    sort: Number.isFinite(Number(item.sort)) ? Number(item.sort) : index,
    enabled: item.enabled !== false,
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : now,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : now
  }
}

export function getCategories(): Category[] {
  ensureDataInitialized()
  const raw = getStorage<unknown>(STORAGE_KEYS.CATEGORIES, [])
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeCategory).filter((item): item is Category => Boolean(item)).sort((a, b) => a.sort - b.sort)
}

export function saveCategories(categories: Category[]): void {
  setStorage(STORAGE_KEYS.CATEGORIES, categories.map((item, index) => ({ ...item, sort: index })))
}

export function createCategory(name: string): Category {
  const categories = getCategories()
  const now = Date.now()
  const category: Category = { id: createId('category'), name: name.trim(), sort: categories.length, enabled: true, createdAt: now, updatedAt: now }
  saveCategories(categories.concat(category))
  return category
}

export function updateCategory(id: string, patch: Partial<Pick<Category, 'name' | 'enabled'>>): Category[] {
  const categories = getCategories().map((item) => item.id === id
    ? { ...item, ...patch, name: patch.name?.trim() || item.name, updatedAt: Date.now() }
    : item)
  saveCategories(categories)
  return categories
}

export function deleteCategory(id: string): Category[] {
  const categories = getCategories().filter((item) => item.id !== id)
  saveCategories(categories)
  return categories
}

export function moveCategory(id: string, direction: -1 | 1): Category[] {
  const categories = getCategories()
  const index = categories.findIndex((item) => item.id === id)
  const nextIndex = index + direction
  if (index < 0 || nextIndex < 0 || nextIndex >= categories.length) return categories
  const next = categories.slice()
  const current = next[index]
  next[index] = next[nextIndex]
  next[nextIndex] = current
  saveCategories(next)
  return next
}
