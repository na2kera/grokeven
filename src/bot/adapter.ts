import type { Env } from "../env";

/**
 * Bot connection adapter. Keeps the relay independent from how the master Bot is reached,
 * so the connection method can change without touching the API or the G2 UI.
 */
export interface DispatchInput {
  requestId: string;
  text: string;
  resultUrl: string;
  resultToken: string;
}

export interface DispatchOutcome {
  /** "sent" = the Bot side accepted delivery; "manual" = nothing sent, operator sends by hand. */
  kind: "sent" | "manual";
  externalRunRef?: string;
}

/** delivered = "no": the request certainly never reached the Bot. "unknown": it may have. */
export class DispatchError extends Error {
  constructor(
    message: string,
    public readonly delivered: "no" | "unknown",
  ) {
    super(message);
  }
}

export interface BotAdapter {
  dispatch(input: DispatchInput): Promise<DispatchOutcome>;
}

export function createBotAdapter(env: Env): BotAdapter {
  switch (env.BOT_ADAPTER) {
    case "routine-webhook":
      return new RoutineWebhookAdapter(env);
    case "manual":
      return new ManualAdapter();
    default:
      throw new DispatchError(`unknown BOT_ADAPTER: ${String(env.BOT_ADAPTER)}`, "no");
  }
}

class ManualAdapter implements BotAdapter {
  async dispatch(): Promise<DispatchOutcome> {
    return { kind: "manual" };
  }
}

/**
 * Posts to a Grok Bot routine webhook URL.
 * The auth scheme (where the secret key goes) is NOT yet verified; see docs/phase0-research.md.
 * The secret goes in ROUTINE_WEBHOOK_AUTH_HEADER (default "Authorization", sent as "Bearer <secret>").
 * Payload is what the routine was instructed to read: { text, request_id, result_url, result_token }.
 */
class RoutineWebhookAdapter implements BotAdapter {
  constructor(private env: Env) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const url = this.env.ROUTINE_WEBHOOK_URL;
    if (!url) throw new DispatchError("ROUTINE_WEBHOOK_URL is not set", "no");
    const headers: Record<string, string> = { "content-type": "application/json" };
    Object.assign(headers, webhookAuthHeaders(this.env));
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          text: input.text,
          request_id: input.requestId,
          result_url: input.resultUrl,
          result_token: input.resultToken,
        }),
      });
    } catch (e) {
      // Connection-level failure: cannot tell whether the request body was received.
      throw new DispatchError(`routine webhook fetch failed: ${(e as Error).message}`, "unknown");
    }
    if (res.status >= 200 && res.status < 300) {
      return { kind: "sent", externalRunRef: res.headers.get("x-request-id") ?? undefined };
    }
    // 4xx: rejected before running. 5xx: may or may not have been accepted.
    throw new DispatchError(`routine webhook responded ${res.status}`, res.status < 500 ? "no" : "unknown");
  }
}

export function webhookAuthHeaders(env: Pick<Env, "ROUTINE_WEBHOOK_SECRET" | "ROUTINE_WEBHOOK_AUTH_HEADER">): Record<string, string> {
  const secret = env.ROUTINE_WEBHOOK_SECRET;
  if (!secret) return {};
  const name = (env.ROUTINE_WEBHOOK_AUTH_HEADER || "Authorization").trim();
  const value = name.toLowerCase() === "authorization" && !/^bearer\s/i.test(secret) ? `Bearer ${secret}` : secret;
  return { [name]: value };
}
