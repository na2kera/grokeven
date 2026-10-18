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

export interface BotAdapter {
  dispatch(input: DispatchInput): Promise<DispatchOutcome>;
}

export function createBotAdapter(env: Env): BotAdapter {
  switch (env.BOT_ADAPTER) {
    case "routine-webhook":
      return new RoutineWebhookAdapter(env);
    case "manual":
    default:
      return new ManualAdapter();
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
 * Until verified, this adapter sends the key as a bearer token and the payload the routine was
 * instructed to read: { text, request_id, result_url, result_token }.
 */
class RoutineWebhookAdapter implements BotAdapter {
  constructor(private env: Env) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const url = this.env.ROUTINE_WEBHOOK_URL;
    if (!url) throw new Error("ROUTINE_WEBHOOK_URL is not set");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.env.ROUTINE_WEBHOOK_SECRET) headers.authorization = `Bearer ${this.env.ROUTINE_WEBHOOK_SECRET}`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        text: input.text,
        request_id: input.requestId,
        result_url: input.resultUrl,
        result_token: input.resultToken,
      }),
    });
    if (!res.ok) throw new Error(`routine webhook responded ${res.status}`);
    return { kind: "sent", externalRunRef: res.headers.get("x-request-id") ?? undefined };
  }
}
