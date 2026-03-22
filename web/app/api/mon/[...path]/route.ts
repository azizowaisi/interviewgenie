import { NextRequest, NextResponse } from "next/server";
import { monitoringBase } from "@/lib/config";

type Ctx = { params: Promise<{ path: string[] }> };

function upstreamHeaders() {
  const headers = new Headers();
  const token = process.env.MONITORING_ADMIN_TOKEN?.trim();
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
    res = await fetch(target, { headers: upstreamHeaders(), cache: "no-store" });
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
  const headers = upstreamHeaders();
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
