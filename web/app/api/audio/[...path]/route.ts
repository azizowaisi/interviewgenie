import { NextRequest, NextResponse } from "next/server";
import { audioBase } from "@/lib/config";

type Ctx = { params: Promise<{ path: string[] }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  const sub = path.join("/");
  const target = new URL(`${audioBase.replace(/\/$/, "")}/${sub}`);
  const body = await req.text();
  const res = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    cache: "no-store",
  });
  const ct = res.headers.get("content-type") || "application/json";
  return new NextResponse(await res.arrayBuffer(), {
    status: res.status,
    headers: { "Content-Type": ct },
  });
}
