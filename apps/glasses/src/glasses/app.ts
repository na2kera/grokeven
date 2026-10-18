import {
  type EvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import { abandonRequest, createRequest, getRequest, RelayError, type RelayRequest } from '../api/relay.ts'
import { getPending, getSettings, isConfigured, setPending } from '../store/settings.ts'
import { buildScreen, centeredMessage, CONTAINER_TOTAL, paginate, wrapText } from './layout.ts'
import {
  type Input,
  type Screen,
  footerFor,
  headerFor,
  pollInterval,
  screenForRequest,
  turnPage,
  waitingMessage,
  WAIT_LIMIT_MS,
} from './state.ts'

let bridge: EvenAppBridge | null = null
let screen: Screen = { kind: 'idle', lastAnswer: null }
let pollTimer: ReturnType<typeof setTimeout> | null = null
let pollToken = 0
/** Listeners for the phone UI (status mirror). */
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
  screen = next
  for (const fn of listeners) fn(screen)
  render()
}

const pagesOf = (text: string) => paginate(wrapText(text))

export async function initGlasses(evenBridge: EvenAppBridge): Promise<void> {
  bridge = evenBridge
  screen = initialScreen()
  const payload = buildScreen(headerFor(screen), bodyLines(), footerFor(screen))
  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({ containerTotalNum: CONTAINER_TOTAL, textObject: payload }),
  )
  for (const fn of listeners) fn(screen)
  // Reopened with a request still pending: re-fetch instead of re-sending (spec 5.3).
  if (screen.kind === 'waiting') schedulePoll(0)
}

function initialScreen(): Screen {
  if (!isConfigured()) return { kind: 'unconfigured' }
  const pending = getPending()
  if (pending?.requestId) {
    return { kind: 'waiting', requestId: pending.requestId, startedAt: pending.startedAt, status: 'accepted', timedOut: false }
  }
  return { kind: 'idle', lastAnswer: null }
}

/** Called on FOREGROUND_ENTER and after phone-side settings changes. */
export function refresh(): void {
  if (screen.kind === 'unconfigured' && isConfigured()) setScreen({ kind: 'idle', lastAnswer: null })
  else if (screen.kind === 'idle' && !isConfigured()) setScreen({ kind: 'unconfigured' })
  else if (screen.kind === 'waiting') schedulePoll(0)
  else render()
}

function bodyLines(): string[] {
  switch (screen.kind) {
    case 'unconfigured':
      return centeredMessage('スマホ側の画面で\n接続先と端末トークンを設定してください')
    case 'idle':
      return centeredMessage(`タップで送信:\n「${getSettings().fixedText}」`)
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
    } while (renderDirty)
  } finally {
    renderInFlight = false
  }
}

// ---------- request flow ----------

export async function sendFixedQuestion(): Promise<void> {
  if (screen.kind !== 'idle' || !isConfigured()) return
  const { conversationId, fixedText } = getSettings()
  // Reuse the pending client id if a previous attempt never got a request_id (idempotent on the relay).
  const pending = getPending()
  const clientRequestId = pending && !pending.requestId ? pending.clientRequestId : crypto.randomUUID()
  const startedAt = Date.now()
  await setPending({ clientRequestId, requestId: null, startedAt })
  setScreen({ kind: 'sending' })
  try {
    const req = await createRequest({ conversationId, clientRequestId, text: fixedText })
    await setPending({ clientRequestId, requestId: req.request_id, startedAt })
    await applyRequest(req, startedAt)
  } catch (e) {
    await handleRelayError(e, null)
  }
}

async function applyRequest(req: RelayRequest, startedAt: number): Promise<void> {
  const done = screenForRequest(req, pagesOf)
  if (done) {
    await setPending(null)
    setScreen(done)
    return
  }
  const elapsed = Date.now() - startedAt
  const timedOut = screen.kind === 'waiting' ? screen.timedOut || elapsed >= WAIT_LIMIT_MS : elapsed >= WAIT_LIMIT_MS
  setScreen({ kind: 'waiting', requestId: req.request_id, startedAt, status: req.status, timedOut })
  if (!timedOut) schedulePoll(pollInterval(elapsed))
}

function schedulePoll(delayMs: number): void {
  if (pollTimer) clearTimeout(pollTimer)
  const token = ++pollToken
  pollTimer = setTimeout(() => void poll(token), delayMs)
}

function cancelPoll(): void {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
  pollToken++
}

async function poll(token: number): Promise<void> {
  if (token !== pollToken || screen.kind !== 'waiting') return
  const { requestId, startedAt } = screen
  try {
    const req = await getRequest(requestId)
    if (token !== pollToken || screen.kind !== 'waiting') return
    await applyRequest(req, startedAt)
  } catch (e) {
    if (token !== pollToken) return
    if (e instanceof RelayError && e.code === 'network') {
      // Transient: keep waiting, show elapsed time, retry on the slow interval.
      setScreen({ ...screen, status: screen.status })
      schedulePoll(pollInterval(Date.now() - startedAt))
      return
    }
    await handleRelayError(e, requestId)
  }
}

async function handleRelayError(e: unknown, requestId: string | null): Promise<void> {
  cancelPoll()
  if (e instanceof RelayError) {
    switch (e.code) {
      case 'unauthorized':
        await setPending(null)
        setScreen({ kind: 'error', message: '認証に失敗しました\nスマホ側で端末トークンを確認してください', requestId, retryable: false })
        return
      case 'in_flight':
        await setPending(null)
        setScreen({ kind: 'error', message: '前の依頼がまだ処理中です\nしばらく待ってから再試行してください', requestId, retryable: true })
        return
      case 'not_found':
        await setPending(null)
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
  if (screen.kind !== 'waiting') return
  const { requestId } = screen
  cancelPoll()
  try {
    await abandonRequest(requestId)
  } catch (e) {
    console.error('abandon failed', e)
  }
  await setPending(null)
  setScreen({ kind: 'idle', lastAnswer: null })
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
  const input = toInput(eventType)
  if (!input) return
  switch (screen.kind) {
    case 'unconfigured':
      if (input === 'double') void bridge?.shutDownPageContainer(1)
      break
    case 'idle':
      if (input === 'click') void sendFixedQuestion()
      else if (input === 'double') void bridge?.shutDownPageContainer(1)
      break
    case 'sending':
      break
    case 'waiting':
      if (input === 'double') void abandonCurrent()
      else if (input === 'click' && screen.timedOut) {
        // "状況を再確認": one more fetch, stays timed out until a result arrives.
        schedulePoll(0)
      }
      break
    case 'answer':
      if (input === 'click') setScreen({ kind: 'idle', lastAnswer: null })
      else if (input === 'double') void bridge?.shutDownPageContainer(1)
      else setScreen(turnPage(screen, input))
      break
    case 'error':
      if (input === 'double') {
        void setPending(null)
        setScreen(isConfigured() ? { kind: 'idle', lastAnswer: null } : { kind: 'unconfigured' })
      } else if (input === 'click' && screen.retryable) {
        if (screen.requestId) {
          const startedAt = getPending()?.startedAt ?? Date.now()
          setScreen({ kind: 'waiting', requestId: screen.requestId, startedAt, status: 'accepted', timedOut: false })
          schedulePoll(0)
        } else {
          setScreen({ kind: 'idle', lastAnswer: null })
          void sendFixedQuestion()
        }
      }
      break
  }
}

export function dispose(): void {
  cancelPoll()
}
