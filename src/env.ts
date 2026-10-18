export interface Env {
  DB: D1Database;
  BOT_ADAPTER: "manual" | "routine-webhook";
  OWNER_ID: string;
  RESULT_TOKEN_TTL_SECONDS: string;
  // secrets
  DEVICE_TOKEN: string;
  RESULT_URL: string;
  ROUTINE_WEBHOOK_URL?: string;
  ROUTINE_WEBHOOK_SECRET?: string;
}
