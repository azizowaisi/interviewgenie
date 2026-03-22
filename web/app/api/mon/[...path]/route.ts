import { NextRequest, NextResponse } from "next/server";
import { monitoringBase } from "@/lib/config";

type Ctx = { params: Promise<{ path: string[] }> };

/** Prefer pod env (GitOps); if unset, forward browser token from /api/mon requests (localStorage → X-Admin-Token). */
function upstreamAuthHeaders(req: NextRequest) {
  const headers = new Headers();
  const server = process.env.MONITORING_ADMIN_TOKEN?.trim();
  const client = req.headers.get("x-admin-token")?.trim();
  const token = server || client;
  if (token) headers.set("X-Admin-Token", token);
  return headers;
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  const sub = path.join("/");
  const target = new URL(`${monitoringBase.replace(/\/$/, "")}/api/${sub}`);
  target.search = req.nextUrl.search;
  let res: Response;
  try {
    res = await fetch(target, { headers: upstreamAuthHeaders(req), cache: "no-store" });
  } catch {
    return NextResponse.json({ error: "monitoring_upstream_unreachable", url: target.origin }, { status: 502 });
  }
  const ct = res.headers.get("content-type") || "application/octet-stream";
  return new NextResponse(await res.arrayBuffer(), {
    status: res.status,
    headers: { "Content-Type": ct },
  });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  const sub = path.join("/");
  const target = new URL(`${monitoringBase.replace(/\/$/, "")}/api/${sub}`);
  target.search = req.nextUrl.search;
  const headers = upstreamAuthHeaders(req);
  const body = await req.arrayBuffer();
  if (body.byteLength) {
    headers.set("Content-Type", req.headers.get("content-type") || "application/json");
  }
  let res: Response;
  try {
    res = await fetch(target, {
      method: "POST",
      headers,
      body: body.byteLength ? body : undefined,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "monitoring_upstream_unreachable", url: target.origin }, { status: 502 });
  }
  const ct = res.headers.get("content-type") || "application/json";
  return new NextResponse(await res.arrayBuffer(), {
    status: res.status,
    headers: { "Content-Type": ct },
  });
}
