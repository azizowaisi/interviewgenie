import { headers } from "next/headers";

import { getPublicAppOriginFromEnv, stripTrailingSlash } from "@/lib/site-url";

/** RSC only — do not import from middleware (Edge). */
export async function getPublicAppOriginForRequest(): Promise<string> {
  const fromEnv = getPublicAppOriginFromEnv();
  if (fromEnv) return fromEnv;
  const h = await headers();
  const hostRaw = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const host = hostRaw.split(",")[0]?.trim() ?? "";
  if (!host) return "";
  let proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  proto = proto.replace(/:$/, "");
  if (proto !== "http" && proto !== "https") proto = "http";
  return stripTrailingSlash(`${proto}://${host}`);
}
