import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        // Pure logic (game engines, helpers) in plain Node: fast. Some play whole games with
        // bots, which takes a few seconds on a slow machine (CI): 20 s each, not the default 5.
        test: { name: "unit", include: ["src/**/*.test.ts"], testTimeout: 20_000 },
      },
      {
        // The real Worker + Room Durable Object running in workerd, driven over WebSockets.
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
        test: { name: "integration", include: ["test/integration/**/*.test.ts"] },
      },
    ],
  },
});
