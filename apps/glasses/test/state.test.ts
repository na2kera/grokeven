import { describe, expect, it } from 'vitest'
import { pollInterval, screenForRequest, turnPage, waitingMessage, type Screen } from '../src/glasses/state.ts'
import type { RelayRequest } from '../src/api/relay.ts'

const base: RelayRequest = {
  request_id: 'r1', conversation_id: 'c', client_request_id: 'k', text: 't', status: 'accepted', answer: null, error: null,
}
const pagesOf = (t: string) => [[t]]

describe('state', () => {
  it('polls every 2s for the first minute, then 5s', () => {
    expect(pollInterval(0)).toBe(2000)
    expect(pollInterval(59_999)).toBe(2000)
    expect(pollInterval(60_000)).toBe(5000)
  })
  it('keeps waiting on in-flight statuses', () => {
    for (const status of ['accepted', 'processing', 'awaiting_approval', 'delivery_unknown'] as const) {
      expect(screenForRequest({ ...base, status }, pagesOf)).toBeNull()
    }
  })
  it('maps completed to the answer screen and failed to error', () => {
    expect(screenForRequest({ ...base, status: 'completed', answer: 'A' }, pagesOf)).toEqual({ kind: 'answer', requestId: 'r1', pages: [['A']], page: 0 })
    const err = screenForRequest({ ...base, status: 'failed', error: 'abandoned' }, pagesOf)
    expect(err?.kind).toBe('error')
  })
  it('does not claim approval from elapsed time', () => {
    expect(waitingMessage('accepted', 130_000, true)).toContain('超えました')
    expect(waitingMessage('accepted', 130_000, true)).not.toContain('承認')
    expect(waitingMessage('awaiting_approval', 1000, false)).toContain('承認待ち')
  })
  it('turns pages within bounds', () => {
    const s: Extract<Screen, { kind: 'answer' }> = { kind: 'answer', requestId: 'r', pages: [['a'], ['b']], page: 0 }
    expect(turnPage(s, 'up').page).toBe(0)
    expect(turnPage(s, 'down').page).toBe(1)
    expect(turnPage(turnPage(s, 'down'), 'down').page).toBe(1)
  })
})
