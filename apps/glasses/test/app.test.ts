import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RelayRequest } from '../src/api/relay.ts'

// ---- mocks (must be declared before importing the module under test) ----
const relay = vi.hoisted(() => ({
  createRequest: vi.fn<(i: { conversationId: string; clientRequestId: string; text: string }) => Promise<RelayRequest>>(),
  getRequest: vi.fn<(id: string) => Promise<RelayRequest>>(),
  abandonRequest: vi.fn<(id: string) => Promise<RelayRequest>>(),
}))
vi.mock('../src/api/relay.ts', async importOriginal => {
  const orig = await importOriginal<typeof import('../src/api/relay.ts')>()
  return { ...orig, ...relay }
})

const sdk = vi.hoisted(() => ({
  rebuild: vi.fn(async () => true),
  create: vi.fn(async () => 0),
  shutdown: vi.fn(async () => true),
}))
vi.mock('@evenrealities/even_hub_sdk', () => ({
  OsEventTypeList: { CLICK_EVENT: 0, SCROLL_TOP_EVENT: 1, SCROLL_BOTTOM_EVENT: 2, DOUBLE_CLICK_EVENT: 3, FOREGROUND_ENTER_EVENT: 4 },
  CreateStartUpPageContainer: class { constructor(public p: unknown) {} },
  RebuildPageContainer: class { constructor(public p: unknown) {} },
  TextContainerProperty: class { constructor(public p: unknown) { Object.assign(this, p) } },
}))

// Minimal localStorage shim (no jsdom dependency).
const mem = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
}

import { __resetForTests, dispose, getScreen, handleInput, initGlasses } from '../src/glasses/app.ts'
import { getPending, initSettingsStore, saveSettings, setPending } from '../src/store/settings.ts'

const bridge = {
  createStartUpPageContainer: sdk.create,
  rebuildPageContainer: sdk.rebuild,
  shutDownPageContainer: sdk.shutdown,
  getLocalStorage: async () => '',
  setLocalStorage: async () => true,
} as any

const CLICK = 0, DOUBLE = 3
const req = (over: Partial<RelayRequest> = {}): RelayRequest => ({
  request_id: 'r1', conversation_id: 'c', client_request_id: 'k', text: 'q', status: 'accepted', answer: null, error: null, ...over,
})
const tick = () => new Promise(r => setTimeout(r, 0))
const flush = async (n = 4) => { for (let i = 0; i < n; i++) await tick() }

async function boot() {
  localStorage.clear()
  await initSettingsStore(bridge)
  await saveSettings({ deviceToken: 'tok', fixedText: 'テスト' })
  await initGlasses(bridge)
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  __resetForTests()
  relay.createRequest.mockReset()
  relay.getRequest.mockReset()
  relay.abandonRequest.mockReset()
})
afterEach(() => {
  dispose()
  vi.useRealTimers()
})

describe('glasses app', () => {
  it('sends on tap, polls, and shows the answer; pending survives until "new question"', async () => {
    await boot()
    expect(getScreen().kind).toBe('idle')
    relay.createRequest.mockResolvedValue(req())
    relay.getRequest.mockResolvedValueOnce(req({ status: 'processing' })).mockResolvedValue(req({ status: 'completed', answer: 'A' }))

    handleInput(CLICK)
    await flush()
    expect(getScreen().kind).toBe('waiting')
    expect(getPending()?.requestId).toBe('r1')

    await vi.advanceTimersByTimeAsync(2100)
    expect(getScreen().kind).toBe('waiting')
    await vi.advanceTimersByTimeAsync(2100)
    expect(getScreen()).toMatchObject({ kind: 'answer', pages: [['A']] })
    expect(getPending()?.requestId).toBe('r1') // kept for reopen

    handleInput(CLICK) // new question
    await flush()
    expect(getScreen().kind).toBe('idle')
    expect(getPending()).toBeNull()
  })

  it('double tap during send does not double-post', async () => {
    await boot()
    let resolve!: (r: RelayRequest) => void
    relay.createRequest.mockReturnValue(new Promise<RelayRequest>(r => { resolve = r }))
    handleInput(CLICK)
    handleInput(CLICK)
    handleInput(CLICK)
    await flush()
    expect(relay.createRequest).toHaveBeenCalledTimes(1)
    resolve(req({ status: 'completed', answer: 'x' }))
    await flush()
    expect(getScreen().kind).toBe('answer')
  })

  it('reuses the same client_request_id and text when a create never returned', async () => {
    await boot()
    await setPending({ clientRequestId: 'old-key', requestId: null, conversationId: 'c', text: '古い質問', startedAt: Date.now() })
    await saveSettings({ fixedText: '新しい質問' })
    relay.createRequest.mockResolvedValue(req({ status: 'completed', answer: 'ok' }))
    handleInput(CLICK)
    await flush()
    expect(relay.createRequest).toHaveBeenCalledWith(expect.objectContaining({ clientRequestId: 'old-key', text: '古い質問' }))
  })

  it('reopen with a pending request re-fetches instead of re-sending', async () => {
    await boot()
    await setPending({ clientRequestId: 'k', requestId: 'r9', conversationId: 'c', text: 'q', startedAt: Date.now() - 30_000 })
    relay.getRequest.mockResolvedValue(req({ request_id: 'r9', status: 'completed', answer: 'late' }))
    __resetForTests()
    await initGlasses(bridge)
    await flush()
    expect(relay.createRequest).not.toHaveBeenCalled()
    expect(getScreen()).toMatchObject({ kind: 'answer', requestId: 'r9' })
  })

  it('network errors while waiting still hit the 120s limit and offer re-check', async () => {
    await boot()
    relay.createRequest.mockResolvedValue(req())
    relay.getRequest.mockRejectedValue(Object.assign(new (await import('../src/api/relay.ts')).RelayError('net', 'network')))
    handleInput(CLICK)
    await flush()
    await vi.advanceTimersByTimeAsync(125_000)
    expect(getScreen()).toMatchObject({ kind: 'waiting', timedOut: true })
    const calls = relay.getRequest.mock.calls.length
    handleInput(CLICK) // 再確認
    await vi.advanceTimersByTimeAsync(10)
    expect(relay.getRequest.mock.calls.length).toBe(calls + 1)
  })

  it('abandon failure keeps the pending request and offers retry', async () => {
    await boot()
    relay.createRequest.mockResolvedValue(req())
    relay.getRequest.mockResolvedValue(req())
    relay.abandonRequest.mockRejectedValue(new Error('boom'))
    handleInput(CLICK)
    await flush()
    handleInput(DOUBLE)
    await flush()
    expect(getScreen().kind).toBe('error')
    expect(getPending()?.requestId).toBe('r1')
    handleInput(DOUBLE) // back -> resume waiting on the known request
    await flush()
    expect(getScreen().kind).toBe('waiting')
  })

  it('abandon success clears pending and returns to idle; a late poll result is ignored', async () => {
    await boot()
    relay.createRequest.mockResolvedValue(req())
    let resolvePoll!: (r: RelayRequest) => void
    relay.getRequest.mockReturnValue(new Promise<RelayRequest>(r => { resolvePoll = r }))
    relay.abandonRequest.mockResolvedValue(req({ status: 'failed', error: 'abandoned' }))
    handleInput(CLICK)
    await flush()
    await vi.advanceTimersByTimeAsync(2100) // poll in flight
    handleInput(DOUBLE)
    await flush()
    expect(getScreen().kind).toBe('idle')
    expect(getPending()).toBeNull()
    resolvePoll(req({ status: 'completed', answer: 'stale' }))
    await flush()
    expect(getScreen().kind).toBe('idle')
  })

  it('dispose stops continuations: a late create response does not render or schedule polls', async () => {
    await boot()
    let resolve!: (r: RelayRequest) => void
    relay.createRequest.mockReturnValue(new Promise<RelayRequest>(r => { resolve = r }))
    handleInput(CLICK)
    await flush()
    dispose()
    const rebuilds = sdk.rebuild.mock.calls.length
    resolve(req())
    await flush()
    await vi.advanceTimersByTimeAsync(5000)
    expect(sdk.rebuild.mock.calls.length).toBe(rebuilds)
    expect(relay.getRequest).not.toHaveBeenCalled()
  })
})
