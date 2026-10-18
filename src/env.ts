export interface Env {
  DB: D1Database;
  BOT_ADAPTER: "manual" | "routine-webhook";
  OWNER_ID: string;
  RESULT_TOKEN_TTL_SECONDS: string;
  /** Comma-separated list of allowed browser origins (Even Hub WebView). Empty = no CORS headers. */
  ALLOWED_ORIGINS?: string;
  // secrets
  DEVICE_TOKEN: string;
  RESULT_URL: string;
  ROUTINE_WEBHOOK_URL?: string;
  ROUTINE_WEBHOOK_SECRET?: string;
  /** Header that carries ROUTINE_WEBHOOK_SECRET. "Authorization" sends "Bearer <secret>". Default: Authorization. */
  ROUTINE_WEBHOOK_AUTH_HEADER?: string;
}
