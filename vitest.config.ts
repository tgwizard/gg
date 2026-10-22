import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        // Pure logic (game engines, helpers) in plain Node: fast.
        test: { name: "unit", include: ["src/**/*.test.ts"] },
      },
      {
        // The real Worker + Room Durable Object running in workerd, driven over WebSockets.
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
        test: { name: "integration", include: ["test/integration/**/*.test.ts"] },
      },
    ],
  },
});
