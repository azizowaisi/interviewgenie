import { NextRequest, NextResponse } from "next/server";
import { apiBase } from "@/lib/config";

/**
 * Spec compatibility: creates a topic + first attempt (CV upload remains separate: POST /api/app/topics/{id}/cv).
 */
export async function POST(req: NextRequest) {
  const uid = req.headers.get("x-user-id");
  if (!uid) {
    return NextResponse.json({ error: "Send X-User-Id (same as /api/app/*)." }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    topic?: string;
    job_description?: string;
    interview_type?: string;
    duration_minutes?: number;
  };
  const base = apiBase.replace(/\/$/, "");
  const tRes = await fetch(`${base}/topics`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": uid },
    body: JSON.stringify({
      topic: body.topic || "Interview",
      job_description: body.job_description,
      interview_type: body.interview_type || "technical",
      duration_minutes: body.duration_minutes ?? 30,
    }),
    cache: "no-store",
  });
  if (!tRes.ok) {
    return new NextResponse(await tRes.text(), { status: tRes.status });
  }
  const topic = (await tRes.json()) as { id: string };
  const aRes = await fetch(`${base}/topics/${topic.id}/attempts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": uid },
    body: JSON.stringify({}),
    cache: "no-store",
  });
  if (!aRes.ok) {
    return new NextResponse(await aRes.text(), { status: aRes.status });
  }
  const attempt = (await aRes.json()) as { id: string };
  return NextResponse.json({ topic_id: topic.id, attempt_id: attempt.id });
}
