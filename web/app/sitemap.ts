import type { MetadataRoute } from "next";

import { getPublicAppOriginFromEnv } from "@/lib/site-url";

function originForSitemap(): string {
  // Server-only. Prefer runtime env so production sitemap uses the real host.
  return getPublicAppOriginFromEnv() || "http://localhost:3002";
}

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = originForSitemap().replace(/\/$/, "");
  const now = new Date();

  const routes = [
    "/",
    "/login",
    "/interview",
    "/upload",
    "/mock",
    "/live",
    "/history",
    "/result",
  ];

  return routes.map((p) => ({
    url: `${origin}${p}`,
    lastModified: now,
    changeFrequency: p === "/" ? "weekly" : "monthly",
    priority: p === "/" ? 1 : 0.7,
  }));
}

