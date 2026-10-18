import type { Env } from "./env";
import { bearer, error, json, readJson } from "./http";
import { timingSafeEqual } from "./crypto";
import { createBotAdapter } from "./bot/adapter";
import {
  countActive,
  createRequest,
  findByClientRequestId,
  findById,
  storeResult,
  toPublic,
  updateStatus,
} from "./requests";

const MAX_TEXT_LENGTH = 2000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === "/healthz") return json({ ok: true });

    // Bot -> relay result delivery. Auth: per-request token, never request_id alone.
    if (request.method === "POST" && path === "/v1/bot-results") return handleBotResult(request, env);

    // Client (G2 app / PC) endpoints. Auth: device token.
    const m = /^\/v1\/requests(?:\/([^/]+))?$/.exec(path);
    if (m) {
      const unauthorized = requireDevice(request, env);
      if (unauthorized) return unauthorized;
      if (request.method === "POST" && !m[1]) return handleCreateRequest(request, env);
      if (request.method === "GET" && m[1]) return handleGetRequest(env, decodeURIComponent(m[1]));
    }

    return error(404, "not_found");
  },
} satisfies ExportedHandler<Env>;

function requireDevice(request: Request, env: Env): Response | null {
  const token = bearer(request);
  if (!env.DEVICE_TOKEN || !token || !timingSafeEqual(token, env.DEVICE_TOKEN)) return error(401, "unauthorized");
  return null;
}

interface CreateBody {
  conversation_id?: unknown;
  client_request_id?: unknown;
  text?: unknown;
}

async function handleCreateRequest(request: Request, env: Env): Promise<Response> {
  const body = await readJson<CreateBody>(request);
  if (!body) return error(400, "invalid_json");
  const conversationId = typeof body.conversation_id === "string" ? body.conversation_id.trim() : "";
  const clientRequestId = typeof body.client_request_id === "string" ? body.client_request_id.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!conversationId || !clientRequestId || !text) return error(400, "missing_field");
  if (text.length > MAX_TEXT_LENGTH) return error(400, "text_too_long");

  const ownerId = env.OWNER_ID;

  // Idempotency: same client_request_id -> existing request, no new dispatch.
  const existing = await findByClientRequestId(env, ownerId, clientRequestId);
  if (existing) return json(toPublic(existing), 200);

  // MVP: one in-flight request per owner.
  if ((await countActive(env, ownerId)) > 0) return error(409, "request_in_flight");

  const { row, resultToken } = await createRequest(env, ownerId, { conversationId, clientRequestId, text });

  const adapter = createBotAdapter(env);
  try {
    const outcome = await adapter.dispatch({
      requestId: row.id,
      text: row.text,
      resultUrl: env.RESULT_URL,
      resultToken,
    });
    if (outcome.kind === "sent") await updateStatus(env, row.id, "accepted", { external_run_ref: outcome.externalRunRef ?? null });
    const fresh = await findById(env, ownerId, row.id);
    const pub = toPublic(fresh ?? row);
    // In manual mode the operator needs the token to hand it to the Bot. Never returned otherwise.
    const extra = outcome.kind === "manual" ? { manual_dispatch: { result_url: env.RESULT_URL, result_token: resultToken } } : {};
    return json({ ...pub, ...extra }, 202);
  } catch (e) {
    // Could not tell whether the Bot received it. Do not retry automatically.
    await updateStatus(env, row.id, "delivery_unknown", { error_code: "dispatch_failed" });
    console.log(JSON.stringify({ event: "dispatch_failed", request_id: row.id, reason: (e as Error).message }));
    const fresh = await findById(env, ownerId, row.id);
    return json(toPublic(fresh ?? row), 202);
  }
}

async function handleGetRequest(env: Env, id: string): Promise<Response> {
  const row = await findById(env, env.OWNER_ID, id);
  if (!row) return error(404, "not_found");
  return json(toPublic(row));
}

interface ResultBody {
  request_id?: unknown;
  answer?: unknown;
}

async function handleBotResult(request: Request, env: Env): Promise<Response> {
  const token = bearer(request);
  if (!token) return error(401, "unauthorized");
  const body = await readJson<ResultBody>(request);
  if (!body) return error(400, "invalid_json");
  const requestId = typeof body.request_id === "string" ? body.request_id : "";
  const answer = typeof body.answer === "string" ? body.answer : "";
  if (!requestId || !answer) return error(400, "missing_field");

  const outcome = await storeResult(env, token, requestId, answer);
  console.log(JSON.stringify({ event: "bot_result", request_id: requestId, outcome }));
  switch (outcome) {
    case "stored":
      return json({ ok: true, request_id: requestId }, 200);
    case "duplicate":
      return json({ ok: true, request_id: requestId, duplicate: true }, 200);
    case "conflict":
      return error(409, "result_already_stored");
    case "unauthorized":
      return error(401, "unauthorized");
  }
}
