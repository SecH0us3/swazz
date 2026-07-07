import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import path from "node:path";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: path.resolve(__dirname, "./wrangler.toml") },
      miniflare: {
        compatibilityDate: "2026-06-10",
        d1Databases: ["DB"],
      }
    }),
  ],
  test: {
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'html'],
    },
  },
});
