import crypto from 'node:crypto'
import { ImportedRecipeDraft } from './types.js'

interface RelayEntry { url: string; expiresAt: number }
const relayEntries = new Map<string, RelayEntry>()
const TTL_MS = 10 * 60 * 1000

function register(url: string, apiBase: string): string {
  const token = crypto.randomBytes(24).toString('base64url')
  relayEntries.set(token, { url, expiresAt: Date.now() + TTL_MS })
  return `${apiBase}/api/import/image/${token}`
}

function relayUrl(value: string | undefined, apiBase: string): string | undefined {
  if (!value || !/^https?:\/\//i.test(value)) return value
  return register(value, apiBase)
}

export function relayDraftImages(draft: ImportedRecipeDraft, apiBase: string): ImportedRecipeDraft {
  return {
    ...draft,
    coverImage: relayUrl(draft.coverImage, apiBase),
    galleryImages: draft.galleryImages.map((url) => relayUrl(url, apiBase) || url),
    steps: draft.steps.map((step) => ({ ...step, image: relayUrl(step.image, apiBase) }))
  }
}

export function consumeRelayToken(token: string): string | null {
  const entry = relayEntries.get(token)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) { relayEntries.delete(token); return null }
  return entry.url
}

export function pruneRelayTokens(): void {
  const now = Date.now()
  relayEntries.forEach((entry, token) => { if (entry.expiresAt <= now) relayEntries.delete(token) })
}
