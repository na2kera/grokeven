import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'

export interface Settings {
  /** Relay base URL, no trailing slash. */
  baseUrl: string
  /** Device token issued for this phone (never bundled in the app). */
  deviceToken: string
  /** Phase 2: the fixed question sent on tap. */
  fixedText: string
  /** App-side conversation id (groups follow-ups on the relay side). */
  conversationId: string
}

/**
 * The request the glasses are working on. Survives app reopen so it can be re-fetched instead of re-sent.
 * It is kept until the user explicitly starts a new question or abandons, so an answer can also be restored.
 */
export interface PendingRequest {
  clientRequestId: string
  requestId: string | null
  /** Exactly what was (or will be) sent, so an idempotent retry never pairs a new text with an old key. */
  conversationId: string
  text: string
  startedAt: number
}

interface Stamped<T> {
  savedAt: number
  value: T
}

export const DEFAULT_BASE_URL = 'https://grokeven-production.na2kera.workers.dev'
export const DEFAULT_FIXED_TEXT = '今日の予定を教えて'

const KEY_SETTINGS = 'grokeven_settings'
const KEY_PENDING = 'grokeven_pending'
const BRIDGE_STORAGE_TIMEOUT_MS = 3000

let bridge: EvenAppBridge | null = null
let settings: Settings = {
  baseUrl: DEFAULT_BASE_URL,
  deviceToken: '',
  fixedText: DEFAULT_FIXED_TEXT,
  conversationId: '',
}
let pending: PendingRequest | null = null

function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), BRIDGE_STORAGE_TIMEOUT_MS)),
  ])
}

function parseStamped<T>(raw: string | null | undefined, validate: (v: unknown) => T | null): Stamped<T> | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw)
    if (typeof p?.savedAt !== 'number') return null
    const value = validate(p.value)
    return value === null ? null : { savedAt: p.savedAt, value }
  } catch {
    return null
  }
}

/**
 * Host storage (bridge) survives WebView recreation; WebView localStorage is the fallback.
 * Both are written, and the NEWER copy wins on read, so a failed host write cannot resurrect stale data.
 */
async function readNewest<T>(key: string, validate: (v: unknown) => T | null): Promise<T | null> {
  let fromHost: Stamped<T> | null = null
  if (bridge) {
    try {
      fromHost = parseStamped(await withTimeout(bridge.getLocalStorage(key), ''), validate)
    } catch {
      // host storage unavailable
    }
  }
  let fromWeb: Stamped<T> | null = null
  try {
    fromWeb = parseStamped(localStorage.getItem(key), validate)
  } catch {
    // WebView storage unavailable
  }
  if (fromHost && fromWeb) return fromHost.savedAt >= fromWeb.savedAt ? fromHost.value : fromWeb.value
  return (fromHost ?? fromWeb)?.value ?? null
}

async function writeBoth<T>(key: string, value: T | null): Promise<void> {
  const raw = value === null ? '' : JSON.stringify({ savedAt: Date.now(), value } satisfies Stamped<T>)
  try {
    if (raw) localStorage.setItem(key, raw)
    else localStorage.removeItem(key)
  } catch {
    // ignore
  }
  if (bridge) {
    try {
      await withTimeout(bridge.setLocalStorage(key, raw), false)
    } catch {
      // ignore: the WebView copy is newer and will win on the next read
    }
  }
}

function validateSettings(v: unknown): Partial<Settings> | null {
  return typeof v === 'object' && v ? (v as Partial<Settings>) : null
}

function validatePending(v: unknown): PendingRequest | null {
  const p = v as Partial<PendingRequest> | null
  if (typeof p?.clientRequestId !== 'string' || typeof p?.startedAt !== 'number') return null
  return {
    clientRequestId: p.clientRequestId,
    requestId: typeof p.requestId === 'string' ? p.requestId : null,
    conversationId: typeof p.conversationId === 'string' ? p.conversationId : '',
    text: typeof p.text === 'string' ? p.text : '',
    startedAt: p.startedAt,
  }
}

/**
 * Dev convenience for the simulator, where the phone UI cannot be typed into by scripts:
 * open the app as http://localhost:5173/#settings=<urlencoded JSON> to seed settings once.
 * The hash is cleared immediately and nothing is bundled; Even Hub never loads the app with a hash.
 * A seed that changes baseUrl without providing a token also drops the stored token, so a crafted
 * link cannot redirect an existing token to another host.
 */
function takeSettingsFromHash(): Partial<Settings> | null {
  if (!import.meta.env.DEV || typeof location === 'undefined') return null
  const m = /[#&]settings=([^&]+)/.exec(location.hash)
  if (!m) return null
  history.replaceState(null, '', location.pathname + location.search)
  try {
    const seed = validateSettings(JSON.parse(decodeURIComponent(m[1])))
    if (seed && typeof seed.baseUrl === 'string' && typeof seed.deviceToken !== 'string') seed.deviceToken = ''
    return seed
  } catch {
    return null
  }
}

export async function initSettingsStore(evenBridge: EvenAppBridge | null): Promise<void> {
  bridge = evenBridge
  const stored = await readNewest(KEY_SETTINGS, validateSettings)
  const seeded = takeSettingsFromHash()
  const s = { ...stored, ...seeded }
  settings = {
    baseUrl: ((typeof s.baseUrl === 'string' && s.baseUrl.trim()) || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    deviceToken: typeof s.deviceToken === 'string' ? s.deviceToken : '',
    fixedText: (typeof s.fixedText === 'string' && s.fixedText.trim()) || DEFAULT_FIXED_TEXT,
    conversationId: (typeof s.conversationId === 'string' && s.conversationId) || crypto.randomUUID(),
  }
  if (seeded || !stored?.conversationId) await writeBoth(KEY_SETTINGS, settings)
  pending = await readNewest(KEY_PENDING, validatePending)
}

export function getSettings(): Settings {
  return settings
}

export async function saveSettings(next: Partial<Settings>): Promise<void> {
  settings = { ...settings, ...next }
  settings.baseUrl = settings.baseUrl.replace(/\/+$/, '')
  await writeBoth(KEY_SETTINGS, settings)
}

export function isConfigured(): boolean {
  return settings.deviceToken.trim().length > 0 && /^https?:\/\//.test(settings.baseUrl)
}

export function getPending(): PendingRequest | null {
  return pending
}

export async function setPending(next: PendingRequest | null): Promise<void> {
  pending = next
  await writeBoth(KEY_PENDING, next)
}
