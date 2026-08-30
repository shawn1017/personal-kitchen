import Taro from '@tarojs/taro'
import { getStorageStrict, STORAGE_KEYS } from './storage'

const H5_IMAGE_PREFIX = 'pk-image:'
const H5_IMAGE_DB = 'personal-kitchen-images'
const H5_IMAGE_STORE = 'images'
const H5_IMAGE_DB_VERSION = 1
const MAX_PERSISTED_IMAGE_BYTES = 4 * 1024 * 1024
const IMAGE_DOWNLOAD_TIMEOUT_MS = 15_000
const IMAGE_GC_GRACE_MS = 24 * 60 * 60 * 1000
const SAFE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])
const GATEWAY_IMAGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/

let imageDbPromise: Promise<IDBDatabase> | null = null
let imageGcPromise: Promise<number> | null = null

interface StoredImageRecord {
  blob?: unknown
  createdAt?: unknown
}

export interface PersistImageOptions {
  apiBase?: string
  accessKey?: string
}

export function getGatewayImageAccessHeaders(path: string, options: PersistImageOptions = {}): Record<string, string> {
  const apiBase = String(options.apiBase || '').trim()
  const accessKey = String(options.accessKey || '').trim()
  if (!apiBase || !accessKey) return {}
  try {
    const base = new URL(apiBase)
    const image = new URL(path)
    const basePath = base.pathname.replace(/\/$/, '')
    if (
      base.protocol !== 'https:' ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      !base.hostname.toLowerCase().endsWith('.supabase.co') ||
      !/^\/functions\/v1\/[^/]+$/.test(basePath) ||
      image.origin !== base.origin ||
      image.username ||
      image.password ||
      image.search ||
      image.hash
    ) return {}
    const imagePrefix = `${basePath}/api/import/image/`
    if (!image.pathname.startsWith(imagePrefix)) return {}
    const token = image.pathname.slice(imagePrefix.length)
    if (!GATEWAY_IMAGE_TOKEN_PATTERN.test(token)) return {}
    return { 'x-kitchen-access': accessKey }
  } catch {
    return {}
  }
}

function isWebEnvironment(): boolean {
  return Taro.getEnv() === Taro.ENV_TYPE.WEB && typeof window !== 'undefined'
}

function canUseBrowserImageStore(): boolean {
  return isWebEnvironment() && typeof indexedDB !== 'undefined' && typeof URL !== 'undefined'
}

export function isPersistedImageReference(path: string): boolean {
  return path.startsWith(H5_IMAGE_PREFIX)
}

function openImageDb(): Promise<IDBDatabase> {
  if (imageDbPromise) return imageDbPromise
  imageDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(H5_IMAGE_DB, H5_IMAGE_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(H5_IMAGE_STORE)) db.createObjectStore(H5_IMAGE_STORE)
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        imageDbPromise = null
      }
      resolve(db)
    }
    request.onerror = () => {
      imageDbPromise = null
      reject(request.error || new Error('无法打开浏览器图片库'))
    }
  })
  return imageDbPromise
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError')
}

async function awaitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal)
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then((value) => {
      signal.removeEventListener('abort', onAbort)
      resolve(value)
    }, (error) => {
      signal.removeEventListener('abort', onAbort)
      reject(error)
    })
  })
}

async function putImageBlob(id: string, blob: Blob, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  const db = await awaitWithSignal(openImageDb(), signal)
  throwIfAborted(signal)
  let abortTransaction: (() => void) | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(H5_IMAGE_STORE, 'readwrite')
      abortTransaction = () => {
        try { transaction.abort() } catch { return }
      }
      if (signal?.aborted) abortTransaction()
      else signal?.addEventListener('abort', abortTransaction, { once: true })
      transaction.objectStore(H5_IMAGE_STORE).put({ blob, createdAt: Date.now() }, id)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error || new Error('浏览器图片保存失败'))
      transaction.onabort = () => reject(signal?.aborted
        ? (signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
        : (transaction.error || new Error('浏览器图片保存已中止')))
    })
  } finally {
    if (abortTransaction) signal?.removeEventListener('abort', abortTransaction)
  }
}

async function getImageBlob(id: string): Promise<Blob | null> {
  const db = await openImageDb()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(H5_IMAGE_STORE, 'readonly')
    const request = transaction.objectStore(H5_IMAGE_STORE).get(id)
    request.onsuccess = () => {
      const blob = (request.result as { blob?: unknown } | undefined)?.blob
      resolve(blob instanceof Blob ? blob : null)
    }
    request.onerror = () => reject(request.error || new Error('浏览器图片读取失败'))
  })
}

async function listStoredImageRecords(): Promise<Array<{ id: string; createdAt: number }>> {
  const db = await openImageDb()
  return new Promise((resolve, reject) => {
    const records: Array<{ id: string; createdAt: number }> = []
    const transaction = db.transaction(H5_IMAGE_STORE, 'readonly')
    const request = transaction.objectStore(H5_IMAGE_STORE).openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve(records)
        return
      }
      const value = cursor.value as StoredImageRecord | undefined
      if (typeof cursor.key === 'string') {
        const createdAt = Number(value?.createdAt)
        records.push({ id: cursor.key, createdAt: Number.isFinite(createdAt) ? createdAt : Number.POSITIVE_INFINITY })
      }
      cursor.continue()
    }
    request.onerror = () => reject(request.error || new Error('浏览器图片清单读取失败'))
    transaction.onabort = () => reject(transaction.error || new Error('浏览器图片清单读取已中止'))
  })
}

function createImageId(): string {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  return `${Date.now().toString(36)}-${randomId}`
}

async function downloadBrowserImage(path: string, signal?: AbortSignal, options?: PersistImageOptions): Promise<Blob> {
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort(signal?.reason)
  if (signal?.aborted) abortFromCaller()
  else signal?.addEventListener('abort', abortFromCaller, { once: true })
  const timer = setTimeout(() => controller.abort(), IMAGE_DOWNLOAD_TIMEOUT_MS)
  try {
    const headers = getGatewayImageAccessHeaders(path, options)
    const response = await fetch(path, { credentials: 'omit', cache: 'no-store', headers, signal: controller.signal })
    if (!response.ok) throw new Error(`download status ${response.status}`)
    const declaredBytes = Number(response.headers.get('content-length') || 0)
    if (declaredBytes > MAX_PERSISTED_IMAGE_BYTES) throw new Error('图片超过 4 MB 限制')
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!SAFE_IMAGE_TYPES.has(contentType)) throw new Error('图片类型不安全')
    if (!response.body) throw new Error('浏览器没有返回可读取的图片内容')

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let totalBytes = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        totalBytes += value.byteLength
        if (totalBytes > MAX_PERSISTED_IMAGE_BYTES) {
          await reader.cancel().catch(() => undefined)
          throw new Error('图片超过 4 MB 限制')
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    const bytes = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    if (bytes.byteLength === 0) throw new Error('图片内容为空')
    throwIfAborted(controller.signal)
    return new Blob([bytes.buffer], { type: contentType })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abortFromCaller)
  }
}

async function persistBrowserImage(path: string, signal?: AbortSignal, options?: PersistImageOptions): Promise<string> {
  if (isPersistedImageReference(path)) return path
  throwIfAborted(signal)
  const blob = await downloadBrowserImage(path, signal, options)
  throwIfAborted(signal)
  const id = createImageId()
  const reference = `${H5_IMAGE_PREFIX}${id}`
  await putImageBlob(id, blob, signal)
  if (signal?.aborted) {
    await deletePersistedImages([reference]).catch(() => undefined)
    throwIfAborted(signal)
  }
  return reference
}

export interface ResolvedPersistedImage {
  src: string
  revoke?: () => void
}

export async function resolvePersistedImage(path: string): Promise<ResolvedPersistedImage> {
  if (!isPersistedImageReference(path)) return { src: path }
  if (!canUseBrowserImageStore()) return { src: '' }
  const blob = await getImageBlob(path.slice(H5_IMAGE_PREFIX.length))
  if (!blob) return { src: '' }
  const src = URL.createObjectURL(blob)
  return { src, revoke: () => URL.revokeObjectURL(src) }
}

function persistedImageId(path: string): string | null {
  if (!isPersistedImageReference(path)) return null
  const id = path.slice(H5_IMAGE_PREFIX.length).trim()
  return id || null
}

function collectPersistedImageIds(value: unknown, ids: Set<string>, seen: Set<object>): void {
  if (typeof value === 'string') {
    const id = persistedImageId(value)
    if (id) ids.add(id)
    return
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    value.forEach((item) => collectPersistedImageIds(item, ids, seen))
    return
  }
  Object.values(value as Record<string, unknown>).forEach((item) => collectPersistedImageIds(item, ids, seen))
}

function referencedPersistedImageIds(): Set<string> {
  const ids = new Set<string>()
  const seen = new Set<object>()
  const recipes = getStorageStrict<unknown>(STORAGE_KEYS.RECIPES, [])
  const orders = getStorageStrict<unknown>(STORAGE_KEYS.ORDERS, [])
  const draft = getStorageStrict<unknown>(STORAGE_KEYS.IMPORT_DRAFT, null)
  if (!Array.isArray(recipes) || !Array.isArray(orders) || (draft !== null && (typeof draft !== 'object' || Array.isArray(draft)))) {
    throw new Error('图片引用数据格式异常，已停止清理')
  }
  collectPersistedImageIds(recipes, ids, seen)
  collectPersistedImageIds(orders, ids, seen)
  collectPersistedImageIds(draft, ids, seen)
  return ids
}

export async function deletePersistedImages(paths: Iterable<string>): Promise<number> {
  if (!canUseBrowserImageStore()) return 0
  const ids = Array.from(new Set(Array.from(paths, persistedImageId).filter((id): id is string => Boolean(id))))
  if (!ids.length) return 0
  const db = await openImageDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(H5_IMAGE_STORE, 'readwrite')
    const store = transaction.objectStore(H5_IMAGE_STORE)
    ids.forEach((id) => store.delete(id))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('浏览器图片删除失败'))
    transaction.onabort = () => reject(transaction.error || new Error('浏览器图片删除已中止'))
  })
  return ids.length
}

export async function garbageCollectPersistedImages(graceMs = IMAGE_GC_GRACE_MS): Promise<number> {
  if (!canUseBrowserImageStore()) return 0
  const referencedBeforeScan = referencedPersistedImageIds()
  const cutoff = Date.now() - Math.max(0, graceMs)
  const candidates = (await listStoredImageRecords())
    .filter(({ id, createdAt }) => createdAt <= cutoff && !referencedBeforeScan.has(id))
    .map(({ id }) => `${H5_IMAGE_PREFIX}${id}`)
  if (!candidates.length) return 0

  // Storage may have changed while IndexedDB was being scanned. Recheck before deleting.
  const referencedBeforeDelete = referencedPersistedImageIds()
  return deletePersistedImages(candidates.filter((path) => {
    const id = persistedImageId(path)
    return Boolean(id && !referencedBeforeDelete.has(id))
  }))
}

export function schedulePersistedImageGarbageCollection(): void {
  if (!canUseBrowserImageStore() || imageGcPromise) return
  imageGcPromise = garbageCollectPersistedImages()
    .catch((error) => {
      console.warn('[image] garbage collection failed', error)
      return 0
    })
    .finally(() => {
      imageGcPromise = null
    })
}

export async function persistImage(path: string, signal?: AbortSignal, options?: PersistImageOptions): Promise<string> {
  if (!path) return ''
  try {
    if (isWebEnvironment()) {
      if (!canUseBrowserImageStore()) throw new Error('浏览器不支持本地图片库')
      return await persistBrowserImage(path, signal, options)
    }
    let tempFilePath = path
    if (/^https?:\/\//i.test(path)) {
      const header = getGatewayImageAccessHeaders(path, options)
      const downloaded = await Taro.downloadFile({ url: path, header })
      if (downloaded.statusCode !== 200) throw new Error(`download status ${downloaded.statusCode}`)
      tempFilePath = downloaded.tempFilePath
    }
    if (tempFilePath.includes('/store/')) return tempFilePath
    const saved = await Taro.saveFile({ tempFilePath })
    if ('savedFilePath' in saved) return saved.savedFilePath
    throw new Error('saveFile failed')
  } catch (error) {
    if (signal?.aborted) throw error
    console.warn('[image] persist failed', error)
    return isWebEnvironment() ? '' : path
  }
}

export async function chooseAndPersistImage(): Promise<string> {
  const result = await Taro.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'] })
  const tempFilePath = result.tempFiles[0]?.tempFilePath || ''
  try {
    return await persistImage(tempFilePath)
  } finally {
    if (isWebEnvironment() && tempFilePath.startsWith('blob:')) URL.revokeObjectURL(tempFilePath)
  }
}
