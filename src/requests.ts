import type { Env } from "./env";
import { randomToken, sha256Hex } from "./crypto";

export type RequestStatus =
  | "accepted"
  | "processing"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "delivery_unknown";

export const ACTIVE_STATUSES: RequestStatus[] = ["accepted", "processing", "awaiting_approval", "delivery_unknown"];

export interface RequestRow {
  id: string;
  owner_id: string;
  conversation_id: string;
  client_request_id: string;
  text: string;
  status: RequestStatus;
  answer: string | null;
  error_code: string | null;
  external_run_ref: string | null;
  result_token_hash: string;
  result_token_expires_at: string;
  result_received_at: string | null;
  created_at: string;
  updated_at: string;
}

export function toPublic(r: RequestRow) {
  return {
    request_id: r.id,
    conversation_id: r.conversation_id,
    client_request_id: r.client_request_id,
    text: r.text,
    status: r.status,
    answer: r.answer,
    error: r.error_code,
    result_token_expires_at: r.result_token_expires_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function findByClientRequestId(env: Env, ownerId: string, clientRequestId: string) {
  return env.DB.prepare("SELECT * FROM requests WHERE owner_id = ? AND client_request_id = ?")
    .bind(ownerId, clientRequestId)
    .first<RequestRow>();
}

export async function findById(env: Env, ownerId: string, id: string) {
  return env.DB.prepare("SELECT * FROM requests WHERE owner_id = ? AND id = ?").bind(ownerId, id).first<RequestRow>();
}

export type CreateOutcome =
  | { kind: "created"; row: RequestRow; resultToken: string }
  | { kind: "existing"; row: RequestRow }
  | { kind: "in_flight" };

/**
 * Insert a new request. Both the idempotency key (owner_id, client_request_id) and the
 * one-in-flight limit are UNIQUE constraints, so concurrent inserts cannot bypass them.
 */
export async function createRequest(
  env: Env,
  ownerId: string,
  input: { conversationId: string; clientRequestId: string; text: string },
): Promise<CreateOutcome> {
  const now = new Date();
  const ttl = Number(env.RESULT_TOKEN_TTL_SECONDS || "1800");
  const id = crypto.randomUUID();
  const resultToken = randomToken();
  const row: RequestRow = {
    id,
    owner_id: ownerId,
    conversation_id: input.conversationId,
    client_request_id: input.clientRequestId,
    text: input.text,
    status: "accepted",
    answer: null,
    error_code: null,
    external_run_ref: null,
    result_token_hash: await sha256Hex(resultToken),
    result_token_expires_at: new Date(now.getTime() + ttl * 1000).toISOString(),
    result_received_at: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  try {
    await env.DB.prepare(
      `INSERT INTO requests (id, owner_id, conversation_id, client_request_id, text, status, answer, error_code,
         external_run_ref, result_token_hash, result_token_expires_at, result_received_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, ?, ?)`,
    )
      .bind(
        row.id,
        row.owner_id,
        row.conversation_id,
        row.client_request_id,
        row.text,
        row.status,
        row.result_token_hash,
        row.result_token_expires_at,
        row.created_at,
        row.updated_at,
      )
      .run();
    return { kind: "created", row, resultToken };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const existing = await findByClientRequestId(env, ownerId, input.clientRequestId);
    if (existing) return { kind: "existing", row: existing };
    return { kind: "in_flight" };
  }
}

function isUniqueViolation(e: unknown): boolean {
  const msg = (e as Error)?.message ?? "";
  return /UNIQUE constraint failed/i.test(msg);
}

/** Record the dispatch outcome without touching a request that has already received its result. */
export async function markDispatched(env: Env, id: string, externalRunRef: string | null) {
  await env.DB.prepare("UPDATE requests SET external_run_ref = ?, updated_at = ? WHERE id = ? AND external_run_ref IS NULL")
    .bind(externalRunRef, new Date().toISOString(), id)
    .run();
}

export async function markDispatchFailed(env: Env, id: string, delivered: "no" | "unknown") {
  const status: RequestStatus = delivered === "no" ? "failed" : "delivery_unknown";
  await env.DB.prepare(
    "UPDATE requests SET status = ?, error_code = 'dispatch_failed', updated_at = ? WHERE id = ? AND result_received_at IS NULL AND status = 'accepted'",
  )
    .bind(status, new Date().toISOString(), id)
    .run();
}

/** Operator gives up waiting. Frees the in-flight slot; a late result can still be stored. */
export async function abandon(env: Env, ownerId: string, id: string): Promise<RequestRow | null> {
  const placeholders = ACTIVE_STATUSES.map(() => "?").join(",");
  await env.DB.prepare(
    `UPDATE requests SET status = 'failed', error_code = 'abandoned', updated_at = ? WHERE owner_id = ? AND id = ? AND status IN (${placeholders})`,
  )
    .bind(new Date().toISOString(), ownerId, id, ...ACTIVE_STATUSES)
    .run();
  return findById(env, ownerId, id);
}

export type ResultOutcome = "stored" | "duplicate" | "conflict" | "unauthorized";

/**
 * Store a Bot result. Auth is the per-request token (never the request_id alone).
 * - token must hash to the row's result_token_hash and be unexpired (checked first, and again in the UPDATE)
 * - first delivery stores the answer and completes the request (also for an abandoned request: late answers are kept)
 * - same answer again -> "duplicate" (no change); different answer -> "conflict" (rejected)
 */
export async function storeResult(env: Env, token: string, requestId: string, answer: string): Promise<ResultOutcome> {
  const hash = await sha256Hex(token);
  const nowIso = new Date().toISOString();
  const row = await env.DB.prepare("SELECT * FROM requests WHERE id = ? AND result_token_hash = ?")
    .bind(requestId, hash)
    .first<RequestRow>();
  if (!row) return "unauthorized";
  if (row.result_token_expires_at <= nowIso) return "unauthorized";
  if (row.result_received_at) return row.answer === answer ? "duplicate" : "conflict";

  const res = await env.DB.prepare(
    `UPDATE requests SET answer = ?, status = 'completed', error_code = NULL, result_received_at = ?, updated_at = ?
     WHERE id = ? AND result_token_hash = ? AND result_received_at IS NULL AND result_token_expires_at > ?`,
  )
    .bind(answer, nowIso, nowIso, requestId, hash, nowIso)
    .run();
  if (res.meta.changes === 1) return "stored";
  // Lost a race with another delivery, or expired between the check and the update.
  const again = await env.DB.prepare("SELECT answer, result_received_at FROM requests WHERE id = ?")
    .bind(requestId)
    .first<{ answer: string | null; result_received_at: string | null }>();
  if (!again?.result_received_at) return "unauthorized";
  return again.answer === answer ? "duplicate" : "conflict";
}
