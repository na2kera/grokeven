import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const DEVICE = { authorization: "Bearer test-device-token", "content-type": "application/json" };
let seq = 0;
const uid = () => `cr-${Date.now()}-${++seq}`;

async function create(clientRequestId: string, text = "テスト質問", headers: Record<string, string> = DEVICE) {
  return SELF.fetch("http://x/v1/requests", {
    method: "POST",
    headers,
    body: JSON.stringify({ conversation_id: "c1", client_request_id: clientRequestId, text }),
  });
}

async function postResult(token: string | null, requestId: string, answer: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return SELF.fetch("http://x/v1/bot-results", { method: "POST", headers, body: JSON.stringify({ request_id: requestId, answer }) });
}

async function get(id: string) {
  return (await (await SELF.fetch(`http://x/v1/requests/${id}`, { headers: DEVICE })).json()) as any;
}

/** Create a request and complete it so the in-flight slot is free again. */
async function createAndComplete(answer = "done") {
  const c = (await (await create(uid())).json()) as any;
  expect((await postResult(c.manual_dispatch.result_token, c.request_id, answer)).status).toBe(200);
  return c;
}

describe("auth", () => {
  it("rejects client calls without or with a wrong device token", async () => {
    expect((await SELF.fetch("http://x/v1/requests", { method: "POST", body: "{}" })).status).toBe(401);
    expect((await create(uid(), "x", { authorization: "Bearer nope", "content-type": "application/json" })).status).toBe(401);
  });

  it("validates the body", async () => {
    const bad = await SELF.fetch("http://x/v1/requests", { method: "POST", headers: DEVICE, body: "{" });
    expect(bad.status).toBe(400);
    const missing = await SELF.fetch("http://x/v1/requests", { method: "POST", headers: DEVICE, body: JSON.stringify({ text: "x" }) });
    expect(missing.status).toBe(400);
  });
});

describe("create", () => {
  it("creates, is idempotent, limits to one in flight, and frees the slot after completion", async () => {
    const a = uid();
    const first = await create(a);
    expect(first.status).toBe(202);
    const body = (await first.json()) as any;
    expect(body.status).toBe("accepted");
    expect(body.manual_dispatch.result_token).toBeTruthy();
    expect(body.manual_dispatch.result_url).toBe("http://example/v1/bot-results");

    const again = await create(a);
    expect(again.status).toBe(200);
    expect(((await again.json()) as any).request_id).toBe(body.request_id);

    expect((await create(uid())).status).toBe(409);

    expect((await postResult(body.manual_dispatch.result_token, body.request_id, "ok")).status).toBe(200);
    expect((await create(uid())).status).toBe(202);
    await abandonAll();
  });

  it("concurrent creates with the same client_request_id yield one request", async () => {
    const a = uid();
    const results = await Promise.all([create(a), create(a), create(a)]);
    const bodies = (await Promise.all(results.map((r) => r.json()))) as any[];
    const ids = new Set(bodies.map((b) => b.request_id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.status === 202).length).toBe(1);
    expect(results.filter((r) => r.status === 200).length).toBe(2);
    await abandonAll();
  });

  it("concurrent creates with different ids admit exactly one", async () => {
    const results = await Promise.all([create(uid()), create(uid()), create(uid())]);
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([202, 409, 409]);
    await abandonAll();
  });
});

describe("bot results", () => {
  it("requires the per-request token: no token, wrong token, another request's token are rejected", async () => {
    const first = await createAndComplete();
    const c = (await (await create(uid())).json()) as any;
    expect((await postResult(null, c.request_id, "x")).status).toBe(401);
    expect((await postResult("wrong", c.request_id, "x")).status).toBe(401);
    expect((await postResult(first.manual_dispatch.result_token, c.request_id, "x")).status).toBe(401);
    expect((await get(c.request_id)).status).toBe("accepted");
    await abandonAll();
  });

  it("stores once; duplicate is a no-op, conflicting answer is rejected; token not exposed on GET", async () => {
    const c = (await (await create(uid(), "明日の予定は？")).json()) as any;
    const token = c.manual_dispatch.result_token as string;

    expect((await postResult(token, c.request_id, "回答本文")).status).toBe(200);
    const dup = await postResult(token, c.request_id, "回答本文");
    expect(dup.status).toBe(200);
    expect(((await dup.json()) as any).duplicate).toBe(true);
    expect((await postResult(token, c.request_id, "別の回答")).status).toBe(409);

    const got = await get(c.request_id);
    expect(got.status).toBe("completed");
    expect(got.answer).toBe("回答本文");
    expect(got.manual_dispatch).toBeUndefined();
    expect(JSON.stringify(got)).not.toContain(token);
  });

  it("concurrent deliveries store exactly one answer", async () => {
    const c = (await (await create(uid())).json()) as any;
    const token = c.manual_dispatch.result_token as string;
    const results = await Promise.all([postResult(token, c.request_id, "A"), postResult(token, c.request_id, "B")]);
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([200, 409]);
    const got = await get(c.request_id);
    expect(["A", "B"]).toContain(got.answer);
    expect(got.status).toBe("completed");
  });

  it("rejects an expired token, even for a duplicate", async () => {
    const c = (await (await create(uid())).json()) as any;
    const token = c.manual_dispatch.result_token as string;
    expect((await postResult(token, c.request_id, "late")).status).toBe(200);
    await env.DB.prepare("UPDATE requests SET result_token_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(c.request_id).run();
    expect((await postResult(token, c.request_id, "late")).status).toBe(401);
  });

  it("keeps a late answer for an abandoned request", async () => {
    const c = (await (await create(uid())).json()) as any;
    const ab = await SELF.fetch(`http://x/v1/requests/${c.request_id}/abandon`, { method: "POST", headers: DEVICE });
    expect(ab.status).toBe(200);
    expect(((await ab.json()) as any).status).toBe("failed");
    expect((await create(uid())).status).toBe(202); // slot freed
    expect((await postResult(c.manual_dispatch.result_token, c.request_id, "遅れた回答")).status).toBe(200);
    const got = await get(c.request_id);
    expect(got.status).toBe("completed");
    expect(got.answer).toBe("遅れた回答");
    await abandonAll();
  });
});

describe("cors", () => {
  it("answers preflight for an allowed origin and adds headers to responses", async () => {
    const pre = await SELF.fetch("http://x/v1/requests", { method: "OPTIONS", headers: { origin: "https://allowed.example" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://allowed.example");
    expect(pre.headers.get("access-control-allow-headers")).toContain("authorization");

    const res = await create(uid(), "x", { ...DEVICE, origin: "https://allowed.example" });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://allowed.example");
    await abandonAll();
  });

  it("adds no CORS headers for an unknown origin", async () => {
    const pre = await SELF.fetch("http://x/v1/requests", { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    expect(pre.headers.get("access-control-allow-origin")).toBeNull();
  });
});

async function abandonAll() {
  await env.DB.prepare(
    "UPDATE requests SET status='failed', error_code='test_cleanup' WHERE status IN ('accepted','processing','awaiting_approval','delivery_unknown')",
  ).run();
}
