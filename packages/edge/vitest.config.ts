// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

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
  resolve: {
    alias: {
      "@swazz/shared": path.resolve(__dirname, "../shared/src/features.ts"),
    },
  },
  test: {
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'html'],
    },
  },
});
