import type { MetadataRoute } from "next";

import { getPublicAppOriginFromEnv } from "@/lib/site-url";

function originForRobots(): string {
  return getPublicAppOriginFromEnv() || "http://localhost:3002";
}

export default function robots(): MetadataRoute.Robots {
  const origin = originForRobots().replace(/\/$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/admin"],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}

