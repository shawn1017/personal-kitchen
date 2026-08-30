import crypto from 'node:crypto'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { ImportedRecipeDraft } from './types.js'

interface RelayEntry { url: string; expiresAt: number }
interface RelayRegistration { token: string; tokenHash: string; url: string; expiresAt: number }

const relayEntries = new Map<string, RelayEntry>()
const TTL_MS = 10 * 60 * 1000
const TABLE_NAME = 'import_relay_tokens'

let supabase: SupabaseClient | null | undefined

function getSupabase(): SupabaseClient | null {
  if (supabase !== undefined) return supabase
  const url = String(process.env.SUPABASE_URL || '').trim()
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!url || !serviceRoleKey) {
    supabase = null
    return supabase
  }
  supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false }
  })
  return supabase
}

function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function createRegistration(url: string): RelayRegistration {
  const token = crypto.randomBytes(24).toString('base64url')
  return { token, tokenHash: tokenHash(token), url, expiresAt: Date.now() + TTL_MS }
}

async function saveRegistrations(registrations: RelayRegistration[]): Promise<void> {
  if (!registrations.length) return
  const client = getSupabase()
  if (!client) {
    registrations.forEach(({ token, url, expiresAt }) => relayEntries.set(token, { url, expiresAt }))
    return
  }
  const { error } = await client.from(TABLE_NAME).insert(registrations.map(({ tokenHash: hash, url, expiresAt }) => ({
    token_hash: hash,
    source_url: url,
    expires_at: new Date(expiresAt).toISOString()
  })))
  if (error) throw new Error('图片中转令牌保存失败')
}

function collectRelayUrls(draft: ImportedRecipeDraft): string[] {
  const urls = [draft.coverImage, ...draft.galleryImages, ...draft.steps.map((step) => step.image)]
  return [...new Set(urls.filter((value): value is string => Boolean(value && /^https?:\/\//i.test(value))))]
}

export async function relayDraftImages(draft: ImportedRecipeDraft, apiBase: string): Promise<ImportedRecipeDraft> {
  const registrations = collectRelayUrls(draft).map(createRegistration)
  await saveRegistrations(registrations)
  const relayed = new Map(registrations.map((entry) => [entry.url, `${apiBase}/api/import/image/${entry.token}`]))
  const relayUrl = (value: string | undefined): string | undefined => value ? relayed.get(value) || value : value
  return {
    ...draft,
    coverImage: relayUrl(draft.coverImage),
    galleryImages: draft.galleryImages.map((url) => relayUrl(url) || url),
    steps: draft.steps.map((step) => ({ ...step, image: relayUrl(step.image) }))
  }
}

export async function consumeRelayToken(token: string): Promise<string | null> {
  const client = getSupabase()
  if (!client) {
    const entry = relayEntries.get(token)
    if (!entry) return null
    if (entry.expiresAt > Date.now()) return entry.url
    relayEntries.delete(token)
    return null
  }
  const hash = tokenHash(token)
  const { data, error } = await client
    .from(TABLE_NAME)
    .select('source_url')
    .eq('token_hash', hash)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (error || !data?.source_url) return null
  return String(data.source_url)
}

export async function pruneRelayTokens(): Promise<void> {
  const client = getSupabase()
  if (!client) {
    const now = Date.now()
    relayEntries.forEach((entry, token) => { if (entry.expiresAt <= now) relayEntries.delete(token) })
    return
  }
  await client.from(TABLE_NAME).delete().lt('expires_at', new Date().toISOString())
}
