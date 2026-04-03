"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createJob } from "@/lib/recruiter-api";

export default function NewJobPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [skillsInput, setSkillsInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const skills = skillsInput
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    setLoading(true);
    setError(null);
    try {
      const job = await createJob({ title: title.trim(), description: description.trim(), skills });
      router.replace(`/recruiter/jobs/${job.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create job");
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-6">
        <Link href="/recruiter" className="text-sm text-muted-foreground hover:underline">
          ← Back to Dashboard
        </Link>
      </div>
      <h1 className="text-2xl font-bold mb-6">Create Job Posting</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="title">
            Job Title <span className="text-destructive">*</span>
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Senior Backend Engineer"
            required
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="description">
            Job Description <span className="text-destructive">*</span>
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the role, responsibilities, and requirements…"
            required
            rows={8}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="skills">
            Required Skills{" "}
            <span className="text-muted-foreground font-normal">(comma-separated)</span>
          </label>
          <input
            id="skills"
            type="text"
            value={skillsInput}
            onChange={(e) => setSkillsInput(e.target.value)}
            placeholder="python, fastapi, docker, kubernetes"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading || !title.trim() || !description.trim()}
            className="bg-primary text-primary-foreground px-6 py-2 rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? "Creating…" : "Create Job"}
          </button>
          <Link href="/recruiter" className="px-6 py-2 rounded-md text-sm border hover:bg-secondary">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
