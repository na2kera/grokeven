import {
  type EvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import { abandonRequest, createRequest, getRequest, RelayError, type RelayRequest } from '../api/relay.ts'
import { getPending, getSettings, isConfigured, setPending, type PendingRequest } from '../store/settings.ts'
import { buildScreen, centeredMessage, CONTAINER_TOTAL, paginate, wrapText } from './layout.ts'
import {
  type Input,
  type Screen,
  footerFor,
  headerFor,
  idlePreview,
  pollInterval,
  screenForRequest,
  turnPage,
  waitingMessage,
  WAIT_LIMIT_MS,
} from './state.ts'

/**
 * Glasses controller. Concurrency model:
 * - `generation` increments whenever the user starts or ends a request; every async continuation
 *   (relay responses, poll timers) checks it and drops stale results.
 * - `busy` serializes user-initiated relay calls (send, abandon) so a second tap cannot double-post.
 * - `disposed` stops every continuation after exit.
 */
let bridge: EvenAppBridge | null = null
let screen: Screen = { kind: 'idle' }
let pollTimer: ReturnType<typeof setTimeout> | null = null
let pollInFlight = false
let generation = 0
let busy = false
let disposed = false
const listeners = new Set<(s: Screen) => void>()

export function onScreenChange(fn: (s: Screen) => void): () => void {
  listeners.add(fn)
  fn(screen)
  return () => listeners.delete(fn)
}

export function getScreen(): Screen {
  return screen
}

function setScreen(next: Screen): void {
  if (disposed) return
  screen = next
  for (const fn of listeners) fn(screen)
  render()
}

const pagesOf = (text: string) => paginate(wrapText(text))

export async function initGlasses(evenBridge: EvenAppBridge): Promise<void> {
  bridge = evenBridge
  disposed = false
  screen = initialScreen()
  const payload = buildScreen(headerFor(screen), bodyLines(), footerFor(screen))
  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({ containerTotalNum: CONTAINER_TOTAL, textObject: payload }),
  )
  for (const fn of listeners) fn(screen)
  // Reopened with a request still pending: re-fetch instead of re-sending (spec 5.3).
  if (screen.kind === 'waiting') schedulePoll(0)
  // Pending without a request_id: the create call never returned. Retry idempotently with the same key.
  else if (screen.kind === 'idle' && getPending() && !getPending()!.requestId) void sendQuestion()
}

function initialScreen(): Screen {
  if (!isConfigured()) return { kind: 'unconfigured' }
  const pending = getPending()
  if (pending?.requestId) {
    return { kind: 'waiting', requestId: pending.requestId, startedAt: pending.startedAt, status: 'accepted', timedOut: false }
  }
  return { kind: 'idle' }
}

/** Called on FOREGROUND_ENTER and after phone-side settings changes. */
export function refresh(): void {
  if (disposed) return
  if (!isConfigured()) {
    if (screen.kind !== 'unconfigured') {
      cancelPoll()
      setScreen({ kind: 'unconfigured' })
    }
    return
  }
  const pending = getPending()
  if (screen.kind === 'unconfigured') {
    // Token was just saved. Resume a pending request if there is one.
    if (pending?.requestId) {
      setScreen({ kind: 'waiting', requestId: pending.requestId, startedAt: pending.startedAt, status: 'accepted', timedOut: false })
      schedulePoll(0)
    } else setScreen({ kind: 'idle' })
  } else if (screen.kind === 'waiting') schedulePoll(0)
  else render()
}

function bodyLines(): string[] {
  switch (screen.kind) {
    case 'unconfigured':
      return centeredMessage('スマホ側の画面で\n接続先と端末トークンを設定してください')
    case 'idle':
      return idlePreview(getSettings().fixedText)
    case 'sending':
      return centeredMessage('送信しています…')
    case 'waiting':
      return centeredMessage(waitingMessage(screen.status, Date.now() - screen.startedAt, screen.timedOut))
    case 'answer':
      return screen.pages[screen.page] ?? ['']
    case 'error':
      return centeredMessage(screen.message)
  }
}

// Rebuilds are serialized (navigateven idiom): overlapping BLE writes could apply out of order.
let renderInFlight = false
let renderDirty = false

function render(): void {
  if (renderInFlight) {
    renderDirty = true
    return
  }
  void renderLoop()
}

async function renderLoop(): Promise<void> {
  if (!bridge) return
  renderInFlight = true
  try {
    do {
      renderDirty = false
      const payload = buildScreen(headerFor(screen), bodyLines(), footerFor(screen))
      try {
        const ok = await bridge.rebuildPageContainer(
          new RebuildPageContainer({ containerTotalNum: CONTAINER_TOTAL, textObject: payload }),
        )
        if (ok === false) console.error('rebuildPageContainer returned false')
      } catch (err) {
        console.error('rebuildPageContainer failed', err)
      }
    } while (renderDirty && !disposed)
  } finally {
    renderInFlight = false
  }
}

// ---------- request flow ----------

export async function sendQuestion(): Promise<void> {
  if (busy || disposed || screen.kind !== 'idle' || !isConfigured()) return
  busy = true
  const gen = ++generation
  try {
    const { conversationId, fixedText } = getSettings()
    // A pending entry without request_id means an earlier create never answered: reuse ITS key and text
    // so the relay's idempotency returns the same request instead of creating a second one.
    const prior = getPending()
    const pending: PendingRequest =
      prior && !prior.requestId && prior.text
        ? prior
        : { clientRequestId: crypto.randomUUID(), requestId: null, conversationId, text: fixedText, startedAt: Date.now() }
    await setPending(pending)
    if (stale(gen)) return
    setScreen({ kind: 'sending' })
    let req: RelayRequest
    try {
      req = await createRequest({ conversationId: pending.conversationId, clientRequestId: pending.clientRequestId, text: pending.text })
    } catch (e) {
      if (stale(gen)) return
      await handleRelayError(e, null, gen)
      return
    }
    if (stale(gen)) return
    await setPending({ ...pending, requestId: req.request_id })
    if (stale(gen)) return
    await applyRequest(req, pending.startedAt, gen)
  } finally {
    busy = false
  }
}

function stale(gen: number): boolean {
  return disposed || gen !== generation
}

async function applyRequest(req: RelayRequest, startedAt: number, gen: number): Promise<void> {
  if (stale(gen)) return
  if (screen.kind !== 'waiting' && screen.kind !== 'sending') return
  const done = screenForRequest(req, pagesOf)
  if (done) {
    // Answer: keep the pending entry so reopening restores it (cleared when the user moves on).
    // Definite failure: nothing left to resume, so forget it and let "戻る" go to idle.
    if (done.kind === 'error') await setPending(null)
    if (stale(gen)) return
    setScreen(done)
    return
  }
  const elapsed = Date.now() - startedAt
  const timedOut = (screen.kind === 'waiting' && screen.timedOut) || elapsed >= WAIT_LIMIT_MS
  setScreen({ kind: 'waiting', requestId: req.request_id, startedAt, status: req.status, timedOut })
  if (!timedOut) schedulePoll(pollInterval(elapsed))
}

function schedulePoll(delayMs: number): void {
  if (disposed) return
  if (pollTimer) clearTimeout(pollTimer)
  const gen = generation
  pollTimer = setTimeout(() => void poll(gen), delayMs)
}

function cancelPoll(): void {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

async function poll(gen: number): Promise<void> {
  if (stale(gen) || screen.kind !== 'waiting' || pollInFlight) return
  const { requestId, startedAt } = screen
  pollInFlight = true
  try {
    const req = await getRequest(requestId)
    await applyRequest(req, startedAt, gen)
  } catch (e) {
    if (stale(gen) || screen.kind !== 'waiting') return
    if (e instanceof RelayError && e.code === 'network') {
      // Transient: keep waiting, but the 120s limit still applies (spec 5.3).
      const elapsed = Date.now() - startedAt
      const timedOut = screen.timedOut || elapsed >= WAIT_LIMIT_MS
      setScreen({ ...screen, timedOut })
      if (!timedOut) schedulePoll(pollInterval(elapsed))
      return
    }
    await handleRelayError(e, requestId, gen)
  } finally {
    pollInFlight = false
  }
}

/** Errors keep the pending entry (except not_found): the relay may still finish it, and 409 would block otherwise. */
async function handleRelayError(e: unknown, requestId: string | null, gen: number): Promise<void> {
  cancelPoll()
  if (stale(gen)) return
  if (e instanceof RelayError) {
    switch (e.code) {
      case 'unauthorized':
        setScreen({ kind: 'error', message: '認証に失敗しました\nスマホ側で端末トークンを確認してください', requestId, retryable: true })
        return
      case 'in_flight':
        // The relay still has an unfinished request we do not know about (e.g. storage was lost). Nothing to resume.
        await setPending(null)
        if (stale(gen)) return
        setScreen({ kind: 'error', message: '前の依頼がまだ処理中です\nしばらく待ってから再試行してください', requestId, retryable: true })
        return
      case 'not_found':
        await setPending(null)
        if (stale(gen)) return
        setScreen({ kind: 'error', message: '依頼が見つかりません', requestId: null, retryable: false })
        return
      case 'network':
        setScreen({ kind: 'error', message: '通信できませんでした\nスマホの接続を確認してください', requestId, retryable: true })
        return
      case 'server':
        setScreen({ kind: 'error', message: `中継サーバーのエラー (${e.status ?? '?'})`, requestId, retryable: true })
        return
    }
  }
  console.error(e)
  setScreen({ kind: 'error', message: '予期しないエラーが発生しました', requestId, retryable: true })
}

async function abandonCurrent(): Promise<void> {
  if (busy || disposed || screen.kind !== 'waiting') return
  busy = true
  const { requestId } = screen
  const gen = ++generation
  cancelPoll()
  try {
    try {
      await abandonRequest(requestId)
    } catch (e) {
      // Could not tell the relay. Keep the pending entry so the request can still be resumed/re-fetched.
      console.error('abandon failed', e)
      if (stale(gen)) return
      setScreen({ kind: 'error', message: '中断を送れませんでした\n通信を確認して再試行してください', requestId, retryable: true })
      return
    }
    if (stale(gen)) return
    await setPending(null)
    setScreen({ kind: 'idle' })
  } finally {
    busy = false
  }
}

/** Resume polling a known request (from error screens and reopen). */
function resume(requestId: string): void {
  const startedAt = getPending()?.startedAt ?? Date.now()
  generation++
  setScreen({ kind: 'waiting', requestId, startedAt, status: 'accepted', timedOut: false })
  schedulePoll(0)
}

// ---------- input ----------

function toInput(eventType: OsEventTypeList): Input | null {
  switch (eventType) {
    case OsEventTypeList.CLICK_EVENT: return 'click'
    case OsEventTypeList.DOUBLE_CLICK_EVENT: return 'double'
    case OsEventTypeList.SCROLL_TOP_EVENT: return 'up'
    case OsEventTypeList.SCROLL_BOTTOM_EVENT: return 'down'
    default: return null
  }
}

export function handleInput(eventType: OsEventTypeList): void {
  if (disposed) return
  const input = toInput(eventType)
  if (!input) return
  switch (screen.kind) {
    case 'unconfigured':
      if (input === 'double') void bridge?.shutDownPageContainer(1)
      break
    case 'idle':
      if (input === 'click') void sendQuestion()
      else if (input === 'double') void bridge?.shutDownPageContainer(1)
      break
    case 'sending':
      break
    case 'waiting':
      if (input === 'double') void abandonCurrent()
      else if (input === 'click' && screen.timedOut) schedulePoll(0) // 状況を再確認
      break
    case 'answer':
      if (busy) break
      if (input === 'click') {
        // New question: this is the point where the answered request is forgotten.
        generation++
        void setPending(null)
        setScreen({ kind: 'idle' })
      } else if (input === 'double') void bridge?.shutDownPageContainer(1)
      else setScreen(turnPage(screen, input))
      break
    case 'error':
      if (busy) break
      if (input === 'double') {
        // Back: resume a known request rather than dropping it.
        if (screen.requestId && getPending()?.requestId === screen.requestId) resume(screen.requestId)
        else {
          generation++
          setScreen(isConfigured() ? { kind: 'idle' } : { kind: 'unconfigured' })
        }
      } else if (input === 'click' && screen.retryable) {
        if (screen.requestId) resume(screen.requestId)
        else {
          generation++
          setScreen({ kind: 'idle' })
          void sendQuestion()
        }
      }
      break
  }
}

export function dispose(): void {
  disposed = true
  generation++
  cancelPoll()
}

