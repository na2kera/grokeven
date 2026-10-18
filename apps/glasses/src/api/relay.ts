import { getSettings } from '../store/settings.ts'

export type RequestStatus =
  | 'accepted'
  | 'processing'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'delivery_unknown'

export interface RelayRequest {
  request_id: string
  conversation_id: string
  client_request_id: string
  text: string
  status: RequestStatus
  answer: string | null
  error: string | null
}

export class RelayError extends Error {
  constructor(
    message: string,
    public readonly code: 'network' | 'unauthorized' | 'in_flight' | 'not_found' | 'server',
    public readonly status?: number,
  ) {
    super(message)
  }
}

const FETCH_TIMEOUT_MS = 10000

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const { baseUrl, deviceToken } = getSettings()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${deviceToken}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (e) {
    throw new RelayError(`network error: ${(e as Error).message}`, 'network')
  } finally {
    clearTimeout(timer)
  }
  if (res.status === 401) throw new RelayError('unauthorized', 'unauthorized', 401)
  if (res.status === 404) throw new RelayError('not found', 'not_found', 404)
  if (res.status === 409) throw new RelayError('request in flight', 'in_flight', 409)
  if (!res.ok) throw new RelayError(`server error ${res.status}`, 'server', res.status)
  return (await res.json()) as T
}

export function createRequest(input: { conversationId: string; clientRequestId: string; text: string }) {
  return call<RelayRequest>('POST', '/v1/requests', {
    conversation_id: input.conversationId,
    client_request_id: input.clientRequestId,
    text: input.text,
  })
}

export function getRequest(requestId: string) {
  return call<RelayRequest>('GET', `/v1/requests/${encodeURIComponent(requestId)}`)
}

export function abandonRequest(requestId: string) {
  return call<RelayRequest>('POST', `/v1/requests/${encodeURIComponent(requestId)}/abandon`)
}

export function whoami() {
  return call<{ origin: string | null; user_agent: string | null; cors_allowed: boolean }>('GET', '/v1/whoami')
}
