import type { Env } from "./env";
import { randomToken, sha256Hex } from "./crypto";

export type RequestStatus =
  | "accepted"
  | "processing"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "delivery_unknown";

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
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

const ACTIVE: RequestStatus[] = ["accepted", "processing", "awaiting_approval", "delivery_unknown"];

export async function findByClientRequestId(env: Env, ownerId: string, clientRequestId: string) {
  return env.DB.prepare("SELECT * FROM requests WHERE owner_id = ? AND client_request_id = ?")
    .bind(ownerId, clientRequestId)
    .first<RequestRow>();
}

export async function findById(env: Env, ownerId: string, id: string) {
  return env.DB.prepare("SELECT * FROM requests WHERE owner_id = ? AND id = ?").bind(ownerId, id).first<RequestRow>();
}

export async function countActive(env: Env, ownerId: string): Promise<number> {
  const placeholders = ACTIVE.map(() => "?").join(",");
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM requests WHERE owner_id = ? AND status IN (${placeholders})`)
    .bind(ownerId, ...ACTIVE)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export interface CreatedRequest {
  row: RequestRow;
  /** Plaintext per-request token. Only returned once, at creation. */
  resultToken: string;
}

export async function createRequest(
  env: Env,
  ownerId: string,
  input: { conversationId: string; clientRequestId: string; text: string },
): Promise<CreatedRequest> {
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
  return { row, resultToken };
}

export async function updateStatus(
  env: Env,
  id: string,
  status: RequestStatus,
  extra: { error_code?: string | null; external_run_ref?: string | null } = {},
) {
  await env.DB.prepare(
    "UPDATE requests SET status = ?, error_code = COALESCE(?, error_code), external_run_ref = COALESCE(?, external_run_ref), updated_at = ? WHERE id = ?",
  )
    .bind(status, extra.error_code ?? null, extra.external_run_ref ?? null, new Date().toISOString(), id)
    .run();
}

export type ResultOutcome = "stored" | "duplicate" | "conflict" | "unauthorized";

/**
 * Store a Bot result. Auth is the per-request token (never the request_id alone).
 * - token must hash to the row's result_token_hash, and be unexpired
 * - first delivery stores the answer and completes the request
 * - same answer again -> "duplicate" (no change); different answer -> "conflict" (rejected)
 */
export async function storeResult(env: Env, token: string, requestId: string, answer: string): Promise<ResultOutcome> {
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare("SELECT * FROM requests WHERE id = ? AND result_token_hash = ?")
    .bind(requestId, hash)
    .first<RequestRow>();
  if (!row) return "unauthorized";
  if (row.result_received_at) {
    return row.answer === answer ? "duplicate" : "conflict";
  }
  if (new Date(row.result_token_expires_at).getTime() < Date.now()) return "unauthorized";
  const now = new Date().toISOString();
  // Atomic: only the first delivery for this row flips result_received_at.
  const res = await env.DB.prepare(
    `UPDATE requests SET answer = ?, status = 'completed', result_received_at = ?, updated_at = ?
     WHERE id = ? AND result_token_hash = ? AND result_received_at IS NULL`,
  )
    .bind(answer, now, now, requestId, hash)
    .run();
  if (res.meta.changes === 1) return "stored";
  const again = await env.DB.prepare("SELECT answer FROM requests WHERE id = ?").bind(requestId).first<{ answer: string }>();
  return again?.answer === answer ? "duplicate" : "conflict";
}
