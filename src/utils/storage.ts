import Taro from '@tarojs/taro'

export const STORAGE_KEYS = {
  CATEGORIES: 'personal_kitchen_categories',
  RECIPES: 'personal_kitchen_recipes',
  CART: 'personal_kitchen_cart',
  ORDERS: 'personal_kitchen_orders',
  SETTINGS: 'personal_kitchen_settings',
  SCHEMA_VERSION: 'personal_kitchen_schema_version',
  IMPORT_DRAFT: 'personal_kitchen_import_draft'
} as const

function decodeValue<T>(value: unknown, defaultValue: T): T {
  if (value === undefined || value === null || value === '') return defaultValue
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return value as T
    }
  }
  return value as T
}

function decodeValueStrict<T>(value: unknown, defaultValue: T): T {
  if (value === undefined || value === null || value === '') return defaultValue
  if (typeof value === 'string') return JSON.parse(value) as T
  return value as T
}

export function getStorage<T>(key: string, defaultValue: T): T {
  try {
    return decodeValue(Taro.getStorageSync<unknown>(key), defaultValue)
  } catch (error) {
    console.warn(`[storage] read failed: ${key}`, error)
    return defaultValue
  }
}

export function getStorageStrict<T>(key: string, defaultValue: T): T {
  return decodeValueStrict(Taro.getStorageSync<unknown>(key), defaultValue)
}

export function setStorage<T>(key: string, value: T): boolean {
  try {
    Taro.setStorageSync(key, value)
    return true
  } catch (error) {
    console.warn(`[storage] write failed: ${key}`, error)
    return false
  }
}

export function removeStorage(key: string): boolean {
  try {
    Taro.removeStorageSync(key)
    return true
  } catch (error) {
    console.warn(`[storage] remove failed: ${key}`, error)
    return false
  }
}

export function hasStorageKey(key: string): boolean {
  try {
    return Taro.getStorageInfoSync().keys.includes(key)
  } catch {
    return false
  }
}
export function hasStorageKeyStrict(key: string): boolean {
  return Taro.getStorageInfoSync().keys.includes(key)
}
