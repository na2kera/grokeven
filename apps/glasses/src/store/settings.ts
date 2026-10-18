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

/** The request the glasses are currently waiting on; survives app reopen so it can be re-fetched. */
export interface PendingRequest {
  clientRequestId: string
  requestId: string | null
  startedAt: number
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

async function readKey(key: string): Promise<string | null> {
  if (bridge) {
    try {
      const raw = await withTimeout(bridge.getLocalStorage(key), '')
      if (raw) return raw
    } catch {
      // host storage unavailable — fall back to WebView storage
    }
  }
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

async function writeKey(key: string, value: string): Promise<void> {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
  if (bridge) {
    try {
      await withTimeout(bridge.setLocalStorage(key, value), false)
    } catch {
      // ignore
    }
  }
}

function parseSettings(raw: string | null): Partial<Settings> | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw)
    return typeof p === 'object' && p ? p : null
  } catch {
    return null
  }
}

function parsePending(raw: string | null): PendingRequest | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw)
    if (typeof p?.clientRequestId !== 'string' || typeof p?.startedAt !== 'number') return null
    return { clientRequestId: p.clientRequestId, requestId: typeof p.requestId === 'string' ? p.requestId : null, startedAt: p.startedAt }
  } catch {
    return null
  }
}

export async function initSettingsStore(evenBridge: EvenAppBridge | null): Promise<void> {
  bridge = evenBridge
  const s = parseSettings(await readKey(KEY_SETTINGS))
  settings = {
    baseUrl: (typeof s?.baseUrl === 'string' && s.baseUrl.trim()) || DEFAULT_BASE_URL,
    deviceToken: typeof s?.deviceToken === 'string' ? s.deviceToken : '',
    fixedText: (typeof s?.fixedText === 'string' && s.fixedText.trim()) || DEFAULT_FIXED_TEXT,
    conversationId: (typeof s?.conversationId === 'string' && s.conversationId) || crypto.randomUUID(),
  }
  if (!s?.conversationId) await writeKey(KEY_SETTINGS, JSON.stringify(settings))
  pending = parsePending(await readKey(KEY_PENDING))
}

export function getSettings(): Settings {
  return settings
}

export async function saveSettings(next: Partial<Settings>): Promise<void> {
  settings = { ...settings, ...next }
  settings.baseUrl = settings.baseUrl.replace(/\/+$/, '')
  await writeKey(KEY_SETTINGS, JSON.stringify(settings))
}

export function isConfigured(): boolean {
  return settings.deviceToken.trim().length > 0 && /^https?:\/\//.test(settings.baseUrl)
}

export function getPending(): PendingRequest | null {
  return pending
}

export async function setPending(next: PendingRequest | null): Promise<void> {
  pending = next
  await writeKey(KEY_PENDING, next ? JSON.stringify(next) : '')
}
