import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

const webDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(webDir, "..");
/** Repo-root `.env` (shared secrets / Docker). */
loadEnvConfig(repoRoot);
/** `web/.env.local` etc. — load second so it overrides; Edge middleware resolves Auth0 vars more reliably from here. */
loadEnvConfig(webDir);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /** Smaller Docker images + single `node server.js` process in production */
  output: "standalone",
  /**
   * CI builds multi-arch images on GitHub-hosted amd64 runners.
   * The linux/arm64 leg runs under QEMU and can SIGILL during Next build worker execution.
   * Limit parallelism to make arm64/QEMU builds more reliable.
   */
  experimental: {
    cpus: 1,
    workerThreads: false,
    staticGenerationMaxConcurrency: 1,
    staticGenerationMinPagesPerWorker: 1000,
  },
};

export default nextConfig;
