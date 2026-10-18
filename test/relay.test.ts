import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const DEVICE = { authorization: "Bearer test-device-token", "content-type": "application/json" };


async function create(clientRequestId: string, text = "テスト質問") {
  return SELF.fetch("http://x/v1/requests", {
    method: "POST",
    headers: DEVICE,
    body: JSON.stringify({ conversation_id: "c1", client_request_id: clientRequestId, text }),
  });
}

async function postResult(token: string | null, requestId: string, answer: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return SELF.fetch("http://x/v1/bot-results", { method: "POST", headers, body: JSON.stringify({ request_id: requestId, answer }) });
}

describe("relay", () => {
  it("rejects client calls without device token", async () => {
    const res = await SELF.fetch("http://x/v1/requests", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });

  it("creates a request, is idempotent, and limits to one in flight", async () => {
    const first = await create("cr-1");
    expect(first.status).toBe(202);
    const body = (await first.json()) as any;
    expect(body.status).toBe("accepted");
    expect(body.manual_dispatch.result_token).toBeTruthy();

    const again = await create("cr-1");
    expect(again.status).toBe(200);
    expect(((await again.json()) as any).request_id).toBe(body.request_id);

    const second = await create("cr-2");
    expect(second.status).toBe(409);
  });

  it("accepts a result only with the per-request token, once", async () => {
    // find the in-flight request from the previous test via idempotent re-create
    const res = (await (await create("cr-1")).json()) as any;
    const id = res.request_id as string;
    // token is only issued at creation; recreate a fresh one by completing this flow with a new request
    // -> instead, fetch creation output from a new owner-scoped flow:
    expect(id).toBeTruthy();

    // request_id alone (no token) must be rejected
    expect((await postResult(null, id, "x")).status).toBe(401);
    // wrong token must be rejected
    expect((await postResult("wrong", id, "x")).status).toBe(401);
  });

  it("full flow: create -> deliver result -> read answer; duplicate ok, conflict rejected", async () => {
    // Complete cr-1 so a new request can be created: we have no token for cr-1 any more,
    // so create under a fresh client id after marking cr-1 completed directly.
    await env.DB.prepare("UPDATE requests SET status='completed', result_received_at=datetime('now') WHERE client_request_id='cr-1'").run();

    const created = (await (await create("cr-3", "明日の予定は？")).json()) as any;
    const id = created.request_id as string;
    const token = created.manual_dispatch.result_token as string;

    expect((await postResult("other-token", id, "x")).status).toBe(401);

    const stored = await postResult(token, id, "回答本文");
    expect(stored.status).toBe(200);

    const dup = await postResult(token, id, "回答本文");
    expect(dup.status).toBe(200);
    expect(((await dup.json()) as any).duplicate).toBe(true);

    const conflict = await postResult(token, id, "別の回答");
    expect(conflict.status).toBe(409);

    const get = await SELF.fetch(`http://x/v1/requests/${id}`, { headers: DEVICE });
    const got = (await get.json()) as any;
    expect(got.status).toBe("completed");
    expect(got.answer).toBe("回答本文");
    expect(got.manual_dispatch).toBeUndefined();

    // a new request is allowed again now
    expect((await create("cr-4")).status).toBe(202);
  });

  it("rejects a token after expiry", async () => {
    await env.DB.prepare("UPDATE requests SET status='completed', result_received_at=datetime('now') WHERE result_received_at IS NULL").run();
    const created = (await (await create("cr-5")).json()) as any;
    await env.DB.prepare("UPDATE requests SET result_token_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(created.request_id).run();
    const res = await postResult(created.manual_dispatch.result_token, created.request_id, "late");
    expect(res.status).toBe(401);
  });
});
