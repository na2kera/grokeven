import type { Env } from "./env";
import { bearer, corsHeaders, error, json, readJson, withHeaders } from "./http";
import { timingSafeEqual } from "./crypto";
import { createBotAdapter, DispatchError } from "./bot/adapter";
import { abandon, createRequest, findById, markDispatched, markDispatchFailed, storeResult, toPublic } from "./requests";

const MAX_TEXT_LENGTH = 2000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === "/healthz") return json({ ok: true });

    // Bot -> relay result delivery. Auth: per-request token, never request_id alone. No CORS: not called from a browser.
    if (request.method === "POST" && path === "/v1/bot-results") return handleBotResult(request, env);

    // Client (G2 app / PC) endpoints. Auth: device token. CORS for the WebView origin.
    const m = /^\/v1\/requests(?:\/([^/]+))?(?:\/(abandon))?$/.exec(path);
    if (m) {
      const cors = corsHeaders(request, env.ALLOWED_ORIGINS);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      const res = await handleClient(request, env, m[1] ? decodeURIComponent(m[1]) : null, m[2] === "abandon");
      return withHeaders(res, cors);
    }

    return error(404, "not_found");
  },
} satisfies ExportedHandler<Env>;

async function handleClient(request: Request, env: Env, id: string | null, isAbandon: boolean): Promise<Response> {
  const token = bearer(request);
  if (!env.DEVICE_TOKEN || !token || !timingSafeEqual(token, env.DEVICE_TOKEN)) return error(401, "unauthorized");
  if (request.method === "POST" && !id) return handleCreateRequest(request, env);
  if (request.method === "GET" && id && !isAbandon) return handleGetRequest(env, id);
  if (request.method === "POST" && id && isAbandon) return handleAbandon(env, id);
  return error(404, "not_found");
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
  const created = await createRequest(env, ownerId, { conversationId, clientRequestId, text });
  // Idempotency: same client_request_id -> existing request, no new dispatch.
  if (created.kind === "existing") return json(toPublic(created.row), 200);
  // MVP: one in-flight request per owner (enforced by the DB).
  if (created.kind === "in_flight") return error(409, "request_in_flight");
  const { row, resultToken } = created;

  try {
    const outcome = await createBotAdapter(env).dispatch({
      requestId: row.id,
      text: row.text,
      resultUrl: env.RESULT_URL,
      resultToken,
    });
    if (outcome.kind === "sent") await markDispatched(env, row.id, outcome.externalRunRef ?? null);
    const fresh = await findById(env, ownerId, row.id);
    const pub = toPublic(fresh ?? row);
    // Verification-only: in manual mode the operator hands the token to the Bot by hand.
    // Never enable BOT_ADAPTER=manual on a deployed Worker (see wrangler.jsonc env.production).
    const extra = outcome.kind === "manual" ? { manual_dispatch: { result_url: env.RESULT_URL, result_token: resultToken } } : {};
    return json({ ...pub, ...extra }, 202);
  } catch (e) {
    // "no": certainly not delivered -> failed (slot freed). "unknown": may have been delivered -> delivery_unknown,
    // never retried automatically; the operator can abandon it.
    const delivered = e instanceof DispatchError ? e.delivered : "unknown";
    await markDispatchFailed(env, row.id, delivered);
    console.log(JSON.stringify({ event: "dispatch_failed", request_id: row.id, delivered, reason: (e as Error).message }));
    const fresh = await findById(env, ownerId, row.id);
    return json(toPublic(fresh ?? row), 202);
  }
}

async function handleGetRequest(env: Env, id: string): Promise<Response> {
  const row = await findById(env, env.OWNER_ID, id);
  if (!row) return error(404, "not_found");
  return json(toPublic(row));
}

async function handleAbandon(env: Env, id: string): Promise<Response> {
  const row = await abandon(env, env.OWNER_ID, id);
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
