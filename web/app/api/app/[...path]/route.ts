import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { apiBase } from "@/lib/config";

type Ctx = { params: Promise<{ path: string[] }> };

async function forward(req: NextRequest, segments: string[]) {
  const path = segments.join("/");
  const target = new URL(`${apiBase.replace(/\/$/, "")}/${path}`);
  target.search = req.nextUrl.search;

  const headers = new Headers();
  const uid = req.headers.get("x-user-id");
  if (uid) headers.set("X-User-Id", uid);
  const auth = req.headers.get("authorization");
  if (auth) headers.set("Authorization", auth);

  // Prefer Auth0 identity when available so data is stable across logout/login.
  try {
    const token = await auth0.getAccessToken();
    if (token?.token) headers.set("Authorization", `Bearer ${token.token}`);
  } catch {
    // Ignore — anonymous/dev flows still use X-User-Id.
  }

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
