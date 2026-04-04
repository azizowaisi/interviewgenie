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
    "/recruiter",
    "/recruiter/setup",
    "/recruiter/jobs/new",
  ];

  return routes.map((p) => ({
    url: `${origin}${p}`,
    lastModified: now,
    changeFrequency: p === "/" ? "daily" : "weekly",
    priority: p === "/" ? 1 : p === "/recruiter" ? 0.9 : 0.8,
  }));
}

