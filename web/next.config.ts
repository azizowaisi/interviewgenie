import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /** Smaller Docker images + single `node server.js` process in production */
  output: "standalone",
};

export default nextConfig;
