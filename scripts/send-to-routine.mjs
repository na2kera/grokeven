#!/usr/bin/env node
// Phase 0 check #2: send one request to the Grok Bot routine webhook by hand.
// Reads ROUTINE_WEBHOOK_URL / ROUTINE_WEBHOOK_SECRET / ROUTINE_WEBHOOK_AUTH_HEADER from .dev.vars (git-ignored).
// Never prints the secret or the full URL.
// Usage: node scripts/send-to-routine.mjs "<question>" [request_id]
//   AUTH_MODE=header (default: header named by ROUTINE_WEBHOOK_AUTH_HEADER, "Authorization" => Bearer)
//   AUTH_MODE=standard (Standard Webhooks HMAC signature) | none
import { readFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";

const vars = Object.fromEntries(
  readFileSync(new URL("../.dev.vars", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const url = vars.ROUTINE_WEBHOOK_URL;
const secret = vars.ROUTINE_WEBHOOK_SECRET ?? "";
if (!url) throw new Error("ROUTINE_WEBHOOK_URL missing in .dev.vars");

const text = process.argv[2] ?? "テストです。「ok」とだけ答えてください。";
const requestId = process.argv[3] ?? `test-${Date.now()}`;
const mode = process.env.AUTH_MODE ?? "header";
const extra = process.env.EXTRA_JSON ? JSON.parse(process.env.EXTRA_JSON) : {};
const body = JSON.stringify({ text, request_id: requestId, ...extra });

const headers = { "content-type": "application/json" };
if (mode === "standard") {
  const id = `msg_${randomUUID()}`;
  const ts = Math.floor(Date.now() / 1000).toString();
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  Object.assign(headers, { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` });
} else if (mode === "header") {
  const name = (vars.ROUTINE_WEBHOOK_AUTH_HEADER || "Authorization").trim();
  const value = name.toLowerCase() === "authorization" && !/^bearer\s/i.test(secret) ? `Bearer ${secret}` : secret;
  headers[name] = value;
}

console.log(`POST ${new URL(url).origin}/… auth=${mode} request_id=${requestId}`);
const res = await fetch(url, { method: "POST", headers, body });
console.log(`HTTP ${res.status} ${res.statusText}`);
console.log((await res.text()).slice(0, 500));
