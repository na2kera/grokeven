import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    test: { setupFiles: ["./test/apply-migrations.ts"] },
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            DEVICE_TOKEN: "test-device-token",
            RESULT_URL: "http://example/v1/bot-results",
            BOT_ADAPTER: "manual",
            ALLOWED_ORIGINS: "https://allowed.example",
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
  };
});
