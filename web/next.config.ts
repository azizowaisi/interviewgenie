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
};

export default nextConfig;
