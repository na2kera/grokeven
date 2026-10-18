// Pure state machine for the glasses screen. No SDK, no network: fully unit-testable.
import type { RelayRequest, RequestStatus } from '../api/relay.ts'

export type Screen =
  | { kind: 'unconfigured' }
  | { kind: 'idle'; lastAnswer: string | null }
  | { kind: 'sending' }
  | { kind: 'waiting'; requestId: string; startedAt: number; status: RequestStatus; timedOut: boolean }
  | { kind: 'answer'; requestId: string; pages: string[][]; page: number }
  | { kind: 'error'; message: string; requestId: string | null; retryable: boolean }

export type Input = 'click' | 'double' | 'up' | 'down'

export const WAIT_LIMIT_MS = 120_000
export const POLL_FAST_MS = 2_000
export const POLL_SLOW_MS = 5_000
export const POLL_FAST_WINDOW_MS = 60_000

/** Poll interval as a function of elapsed waiting time (spec 5.3: 2s, longer when waiting long). */
export function pollInterval(elapsedMs: number): number {
  return elapsedMs < POLL_FAST_WINDOW_MS ? POLL_FAST_MS : POLL_SLOW_MS
}

export const STATUS_LABEL: Record<RequestStatus, string> = {
  accepted: '送信中',
  processing: '処理中',
  awaiting_approval: '承認待ち',
  completed: '回答',
  failed: 'エラー',
  delivery_unknown: '送信結果不明',
}

/** Status text for the waiting screen. Never guesses awaiting_approval from elapsed time alone. */
export function waitingMessage(status: RequestStatus, elapsedMs: number, timedOut: boolean): string {
  const secs = Math.floor(elapsedMs / 1000)
  if (timedOut) return `回答待ちが${Math.floor(WAIT_LIMIT_MS / 1000)}秒を超えました\nBotは処理中かもしれません\n(${secs}秒経過)`
  if (status === 'accepted') return `Botに送信しました\n回答を待っています… ${secs}秒`
  if (status === 'processing') return `Botが処理中です… ${secs}秒`
  if (status === 'awaiting_approval') return `Botが承認待ちです\n公式アプリで確認してください`
  if (status === 'delivery_unknown') return `送信結果が確認できません\n公式アプリで確認してください`
  return `${STATUS_LABEL[status]}… ${secs}秒`
}

export function headerFor(screen: Screen): string {
  switch (screen.kind) {
    case 'unconfigured': return 'Bot Relay  未設定'
    case 'idle': return 'Bot Relay'
    case 'sending': return 'Bot Relay  送信中'
    case 'waiting': return `Bot Relay  ${screen.timedOut ? '時間超過' : STATUS_LABEL[screen.status]}`
    case 'answer': return `回答  ${screen.page + 1}/${screen.pages.length}`
    case 'error': return 'Bot Relay  エラー'
  }
}

export function footerFor(screen: Screen): string {
  switch (screen.kind) {
    case 'unconfigured': return '2回タップ: 終了'
    case 'idle': return 'タップ: 送信   2回タップ: 終了'
    case 'sending': return ' '
    case 'waiting': return screen.timedOut ? 'タップ: 再確認   2回: 中断' : '2回タップ: 中断'
    case 'answer': return 'スワイプ: ページ   タップ: 新しい質問   2回: 終了'
    case 'error': return screen.retryable ? 'タップ: 再試行   2回: 戻る' : '2回タップ: 戻る'
  }
}

/** Map a finished relay request to the next screen. Returns null while still in flight. */
export function screenForRequest(req: RelayRequest, pagesOf: (text: string) => string[][]): Screen | null {
  switch (req.status) {
    case 'completed':
      return { kind: 'answer', requestId: req.request_id, pages: pagesOf(req.answer ?? ''), page: 0 }
    case 'failed':
      return {
        kind: 'error',
        message: req.error === 'abandoned' ? '依頼を中断しました' : `Botへの送信に失敗しました\n(${req.error ?? 'failed'})`,
        requestId: req.request_id,
        retryable: false,
      }
    default:
      return null
  }
}

/** Page navigation on the answer screen; the caller handles click/double. */
export type AnswerScreen = Extract<Screen, { kind: 'answer' }>

export function turnPage(screen: AnswerScreen, input: Input): AnswerScreen {
  if (input === 'down' && screen.page < screen.pages.length - 1) return { ...screen, page: screen.page + 1 }
  if (input === 'up' && screen.page > 0) return { ...screen, page: screen.page - 1 }
  return screen
}
