import { NextRequest, NextResponse } from "next/server";
import { audioBase } from "@/lib/config";

/** Spec compatibility: forwards to audio-service /mock/evaluate-attempt */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const res = await fetch(`${audioBase.replace(/\/$/, "")}/mock/evaluate-attempt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    cache: "no-store",
  });
  return new NextResponse(await res.arrayBuffer(), {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
  });
}
