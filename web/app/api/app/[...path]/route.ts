import { NextRequest, NextResponse } from "next/server";
import { apiBase } from "@/lib/config";

type Ctx = { params: Promise<{ path: string[] }> };

async function forward(req: NextRequest, segments: string[]) {
  const path = segments.join("/");
  const target = new URL(`${apiBase.replace(/\/$/, "")}/${path}`);
  target.search = req.nextUrl.search;

  const headers = new Headers();
  const uid = req.headers.get("x-user-id");
  if (uid) headers.set("X-User-Id", uid);

  const init: RequestInit = {
    method: req.method,
    headers,
    cache: "no-store",
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    const body = await req.arrayBuffer();
    if (body.byteLength) init.body = body;
    const ct = req.headers.get("content-type");
    if (ct) headers.set("Content-Type", ct);
  }

  const res = await fetch(target, init);
  const outHeaders = new Headers(res.headers);
  outHeaders.delete("content-encoding");
  outHeaders.delete("transfer-encoding");
  return new NextResponse(await res.arrayBuffer(), {
    status: res.status,
    headers: outHeaders,
  });
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return forward(req, path);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return forward(req, path);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return forward(req, path);
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return forward(req, path);
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return forward(req, path);
}
