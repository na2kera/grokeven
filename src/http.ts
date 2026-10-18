export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function error(status: number, code: string, message?: string): Response {
  return json({ error: { code, message: message ?? code } }, status);
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

/**
 * CORS for the Even Hub WebView. ALLOWED_ORIGINS is a comma-separated list, or "*" to allow any origin.
 * "*" is acceptable here because auth is a bearer token, never cookies; the WebView origin is undocumented
 * (see docs/phase0-research.md) and is discovered via GET /v1/whoami.
 */
export function corsHeaders(req: Request, allowedOrigins: string | undefined): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin || !allowedOrigins) return {};
  const allowed = allowedOrigins.split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes("*") && !allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "600",
    vary: "origin",
  };
}

export function withHeaders(res: Response, headers: Record<string, string>): Response {
  if (Object.keys(headers).length === 0) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}
