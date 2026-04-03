"use client";

import { appFetch } from "@/lib/api-fetch";

export interface Job {
  id: string;
  company_id: string;
  title: string;
  description: string;
  skills: string[];
  created_at: string;
  candidate_count?: number;
}

export interface Candidate {
  id: string;
  job_id: string;
  name: string;
  email: string;
  skills: string[];
  experience_years: number;
  score: number;
  status: "new" | "shortlisted" | "interviewed" | "rejected";
  uploaded_at: string;
}

export interface AiInterviewResult {
  job_id: string;
  candidate_id: string;
  candidate_name: string;
  job_title: string;
  questions: string;
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

export async function listJobs(): Promise<Job[]> {
  const res = await appFetch("/recruiter/jobs");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getJob(jobId: string): Promise<Job> {
  const res = await appFetch(`/recruiter/jobs/${jobId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createJob(data: { title: string; description: string; skills: string[] }): Promise<Job> {
  const res = await appFetch("/recruiter/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteJob(jobId: string): Promise<void> {
  const res = await appFetch(`/recruiter/jobs/${jobId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new Error(await res.text());
}

// ── Candidates ────────────────────────────────────────────────────────────────

export async function listCandidates(jobId: string, status?: string): Promise<Candidate[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await appFetch(`/recruiter/jobs/${jobId}/candidates${qs}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function uploadCandidateCV(jobId: string, file: File): Promise<Candidate> {
  const form = new FormData();
  form.append("file", file);
  const res = await appFetch(`/recruiter/jobs/${jobId}/candidates`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateCandidateStatus(candidateId: string, status: string): Promise<void> {
  const res = await appFetch(`/recruiter/candidates/${candidateId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(await res.text());
}

// ── Role setup ────────────────────────────────────────────────────────────────

export async function setUserRole(role: "candidate" | "recruiter", companyName?: string) {
  const res = await appFetch("/users/me/role", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, company_name: companyName }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── AI Interview ──────────────────────────────────────────────────────────────

export async function startAiInterview(jobId: string, candidateId: string): Promise<AiInterviewResult> {
  const res = await appFetch("/recruiter/interview/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: jobId, candidate_id: candidateId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
