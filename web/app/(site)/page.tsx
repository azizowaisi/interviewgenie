import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Mic,
  BarChart3,
  Users,
  Sparkles,
  Zap,
  Target,
  Building2,
  UserCheck,
  FileSearch,
  BrainCircuit,
  ClipboardList,
  TrendingUp,
  Star,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";

export const metadata: Metadata = {
  title: "AI Interview Coach for Candidates and Recruiters",
  description:
    "Use InterviewGenie to practice mock interviews, improve your ATS resume score, and get STAR-based feedback. Recruiters can parse CVs, score candidates, and generate interview questions with AI.",
  keywords: [
    "AI mock interview",
    "AI interview coach",
    "ATS resume scanner",
    "resume keyword optimization",
    "technical interview simulator",
    "recruiter candidate ranking",
    "AI hiring platform",
    "CV screening software",
  ],
  alternates: {
    canonical: "/",
  },
};

// ── Shared social proof ───────────────────────────────────────────────────────

const stats = [
  { value: "10k+", label: "Interviews completed" },
  { value: "94%", label: "Candidate satisfaction" },
  { value: "3×", label: "Faster shortlisting" },
  { value: "60+", label: "Skills detected automatically" },
];

// ── Candidate side ────────────────────────────────────────────────────────────

const candidateFeatures = [
  {
    icon: Mic,
    title: "Live mock interviews",
    desc: "Speak your answers, get real-time STAR-format feedback powered by a local LLM — fully private.",
  },
  {
    icon: BarChart3,
    title: "ATS score analysis",
    desc: "Upload your CV against any job description and see exactly which skills match or are missing.",
  },
  {
    icon: BrainCircuit,
    title: "HR & Technical modes",
    desc: "Switch between behavioural HR rounds and deep technical sessions tailored to your target role.",
  },
  {
    icon: TrendingUp,
    title: "Track your progress",
    desc: "Review session history, retake interviews, and watch your score improve over time.",
  },
  {
    icon: Target,
    title: "Role-specific questions",
    desc: "Questions are generated from your CV and the job description — never generic, always relevant.",
  },
  {
    icon: Zap,
    title: "Instant STAR answers",
    desc: "Struggling with an answer? Get a structured Situation-Task-Action-Result suggestion in under 2 s.",
  },
];

const candidateSteps = [
  "Upload your CV",
  "Paste the job description",
  "See your ATS score & gaps",
  "Start a mock interview",
  "Get AI feedback",
  "Retake & improve",
];

// ── Recruiter side ────────────────────────────────────────────────────────────

const recruiterFeatures = [
  {
    icon: ClipboardList,
    title: "Job management",
    desc: "Create job postings with required skills. All your openings, candidates, and progress in one place.",
  },
  {
    icon: FileSearch,
    title: "Automated CV parsing",
    desc: "Upload any PDF or DOCX. We extract name, email, skills and years of experience automatically.",
  },
  {
    icon: Star,
    title: "Candidate scoring",
    desc: "Each candidate gets a 0–100 match score based on skill overlap and experience against your role.",
  },
  {
    icon: UserCheck,
    title: "Status pipeline",
    desc: "Move candidates from New → Shortlisted → Interviewed → Offer in a Kanban-style status workflow.",
  },
  {
    icon: BrainCircuit,
    title: "AI-generated interview questions",
    desc: "One click generates 3 personalised interview questions based on the job and the candidate's CV.",
  },
  {
    icon: Users,
    title: "Team access",
    desc: "Invite teammates to your company workspace. Everyone sees the same pipeline, no duplicates.",
  },
];

const recruiterSteps = [
  "Set up company account",
  "Create a job posting",
  "Upload candidate CVs",
  "Review ranked shortlist",
  "Generate AI interview questions",
  "Make your decision",
];

// ── Testimonials ──────────────────────────────────────────────────────────────

const testimonials = [
  {
    quote: "I went from blanking mid-interview to landing my dream job in 3 weeks. The STAR feedback is a game changer.",
    name: "Sara L.",
    role: "Software Engineer",
    type: "candidate" as const,
  },
  {
    quote: "We cut our time-to-shortlist from 4 days to a few hours. The auto-scoring alone saves the team hours per role.",
    name: "James K.",
    role: "Head of Talent, TechCorp",
    type: "recruiter" as const,
  },
  {
    quote: "My ATS score went from 42 to 89 after two iterations. I knew exactly what keywords to add.",
    name: "Priya M.",
    role: "Product Manager",
    type: "candidate" as const,
  },
];

const faqItems = [
  {
    q: "What is InterviewGenie?",
    a: "InterviewGenie is an AI interview platform for both candidates and recruiters. Candidates can run mock interviews, improve ATS resume match, and get STAR feedback. Recruiters can parse CVs, score candidates, and generate interview questions.",
  },
  {
    q: "How does InterviewGenie help candidates pass interviews?",
    a: "InterviewGenie analyzes your resume against a target job description, identifies missing keywords, and lets you practice role-specific HR and technical interview questions with actionable feedback.",
  },
  {
    q: "How does InterviewGenie help recruiters hire faster?",
    a: "Recruiters can upload CVs in bulk, extract candidate data automatically, rank candidates by job fit, and generate personalized interview questions, reducing manual screening time.",
  },
  {
    q: "Does InterviewGenie support ATS resume optimization?",
    a: "Yes. InterviewGenie provides ATS score analysis, missing keyword suggestions, and resume improvement guidance for professional summary, skills, and experience sections.",
  },
];

const homeJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "InterviewGenie",
      url: "https://interviewgenie.ai",
      sameAs: ["https://github.com/azizowaisi/interviewgenie"],
    },
    {
      "@type": "SoftwareApplication",
      name: "InterviewGenie",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "AI interview and hiring platform with mock interview practice, ATS resume checker, candidate scoring, and interview question generation.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
      featureList: [
        "AI mock interviews",
        "ATS resume score analysis",
        "STAR feedback and answer coaching",
        "Recruiter candidate ranking",
        "Automated CV parsing",
      ],
    },
    {
      "@type": "FAQPage",
      mainEntity: faqItems.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.a,
        },
      })),
    },
  ],
};

// ═════════════════════════════════════════════════════════════════════════════

export default function LandingPage() {
  return (
    <div className="overflow-x-hidden">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homeJsonLd) }}
      />

      {/* ── HERO ─────────────────────────────────────────────────────────────── */}
      <section className="relative border-b bg-gradient-to-b from-background to-secondary/20 px-4 py-20 md:py-28 text-center">
        <div className="mx-auto max-w-4xl space-y-6">
          <Badge variant="secondary" className="mx-auto w-fit px-4 py-1 text-sm">
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            AI-powered interview platform
          </Badge>
          <h1 className="text-4xl font-extrabold tracking-tight md:text-6xl lg:text-7xl">
            The Interview Platform<br />
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              Built for Both Sides
            </span>
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground md:text-xl">
            Whether you&apos;re preparing to land the role or hiring the right person —
            Interview Genie gives you the AI advantage.
          </p>

          {/* Two CTA tracks */}
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center pt-2">
            <Link
              href="/interview"
              className="group inline-flex items-center gap-2 rounded-xl bg-primary px-7 py-3.5 text-base font-semibold text-primary-foreground shadow-lg hover:bg-primary/90 transition-all"
            >
              <Mic className="h-5 w-5" />
              I&apos;m a Candidate
              <ChevronRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link
              href="/recruiter"
              className="group inline-flex items-center gap-2 rounded-xl border-2 border-primary/30 bg-background px-7 py-3.5 text-base font-semibold hover:border-primary/60 hover:bg-secondary/40 transition-all"
            >
              <Building2 className="h-5 w-5 text-primary" />
              I&apos;m a Recruiter
              <ChevronRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── STATS BAR ────────────────────────────────────────────────────────── */}
      <section className="border-b bg-muted/30 px-4 py-8">
        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-6 md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <p className="text-3xl font-extrabold text-primary">{s.value}</p>
              <p className="mt-1 text-sm text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CANDIDATE SECTION ────────────────────────────────────────────────── */}
      <section className="px-4 py-20 md:py-24">
        <div className="mx-auto max-w-6xl space-y-12">

          {/* Header */}
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 text-sm font-medium text-primary">
                <Mic className="h-4 w-4" />
                For Candidates
              </div>
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
                Walk into every interview prepared
              </h2>
              <p className="max-w-xl text-muted-foreground text-base">
                Practice with an AI that knows your CV and the job you&apos;re targeting.
                Get STAR-format answer suggestions, ATS gap analysis, and detailed feedback on every answer.
              </p>
            </div>
            <Button size="lg" asChild className="shrink-0">
              <Link href="/interview" prefetch={false}>
                Start free practice
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>

          {/* Feature grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {candidateFeatures.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="group rounded-xl border bg-card p-5 shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
              >
                <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mb-1 font-semibold">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          {/* How it works */}
          <div className="rounded-2xl border bg-muted/20 p-6 md:p-8">
            <h3 className="mb-6 text-lg font-semibold">How it works for candidates</h3>
            <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
              {candidateSteps.map((step, i) => (
                <li key={step} className="flex flex-col items-center gap-2 text-center">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                    {i + 1}
                  </span>
                  <span className="text-xs font-medium leading-snug">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ── DIVIDER ──────────────────────────────────────────────────────────── */}
      <div className="relative px-4">
        <div className="mx-auto max-w-6xl border-t border-dashed" />
      </div>

      {/* ── RECRUITER SECTION ────────────────────────────────────────────────── */}
      <section className="bg-secondary/10 px-4 py-20 md:py-24">
        <div className="mx-auto max-w-6xl space-y-12">

          {/* Header */}
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/5 px-4 py-1.5 text-sm font-medium text-emerald-500">
                <Building2 className="h-4 w-4" />
                For Recruiters &amp; Hiring Teams
              </div>
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
                Hire smarter, not harder
              </h2>
              <p className="max-w-xl text-muted-foreground text-base">
                Post jobs, upload CVs, and get a scored, ranked candidate list in minutes.
                Let AI handle the heavy lifting — from CV parsing to generating personalised interview questions.
              </p>
            </div>
            <Button size="lg" variant="outline" asChild className="shrink-0 border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10">
              <Link href="/recruiter" prefetch={false}>
                Start hiring
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>

          {/* Feature grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recruiterFeatures.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="group rounded-xl border bg-card p-5 shadow-sm transition-all hover:border-emerald-500/40 hover:shadow-md"
              >
                <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10">
                  <Icon className="h-5 w-5 text-emerald-500" />
                </div>
                <h3 className="mb-1 font-semibold">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          {/* How it works */}
          <div className="rounded-2xl border bg-muted/20 p-6 md:p-8">
            <h3 className="mb-6 text-lg font-semibold">How it works for recruiters</h3>
            <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
              {recruiterSteps.map((step, i) => (
                <li key={step} className="flex flex-col items-center gap-2 text-center">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
                    {i + 1}
                  </span>
                  <span className="text-xs font-medium leading-snug">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ─────────────────────────────────────────────────────── */}
      <section className="px-4 py-20 md:py-24">
        <div className="mx-auto max-w-5xl space-y-12">
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-bold tracking-tight">What people are saying</h2>
            <p className="text-muted-foreground">Real results from candidates and hiring teams.</p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {testimonials.map((t) => (
              <div
                key={t.name}
                className={`rounded-xl border p-5 shadow-sm ${
                  t.type === "recruiter"
                    ? "border-emerald-500/20 bg-emerald-500/5"
                    : "border-primary/20 bg-primary/5"
                }`}
              >
                <div className="mb-2 flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                  ))}
                </div>
                <p className="mb-4 text-sm leading-relaxed text-muted-foreground">&ldquo;{t.quote}&rdquo;</p>
                <div className="flex items-center gap-2">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                      t.type === "recruiter"
                        ? "bg-emerald-500/20 text-emerald-600"
                        : "bg-primary/20 text-primary"
                    }`}
                  >
                    {t.name[0]}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SEO FAQ ─────────────────────────────────────────────────────────── */}
      <section className="border-t bg-muted/20 px-4 py-20 md:py-24">
        <div className="mx-auto max-w-4xl space-y-10">
          <div className="space-y-2 text-center">
            <h2 className="text-3xl font-bold tracking-tight">InterviewGenie FAQ</h2>
            <p className="text-muted-foreground">
              Common questions about AI interview practice, ATS resume scoring, and recruiter workflows.
            </p>
          </div>
          <div className="space-y-4">
            {faqItems.map((item) => (
              <article key={item.q} className="rounded-xl border bg-card p-5">
                <h3 className="text-base font-semibold">{item.q}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ────────────────────────────────────────────────────────── */}
      <section className="border-t bg-gradient-to-b from-secondary/20 to-background px-4 py-20 md:py-24">
        <div className="mx-auto max-w-4xl">
          <div className="grid gap-6 md:grid-cols-2">

            {/* Candidate CTA card */}
            <div className="rounded-2xl border border-primary/20 bg-card p-8 space-y-4 shadow-md">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                <Mic className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-xl font-bold">Ready to land the role?</h3>
              <p className="text-sm text-muted-foreground">
                Upload your CV, practice with AI-generated questions, and get feedback that turns nervous stumbles
                into confident, structured answers.
              </p>
              <ul className="space-y-1.5">
                {["Free to start", "Works with any job description", "Runs fully locally — no data sent externally"].map((p) => (
                  <li key={p} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                    {p}
                  </li>
                ))}
              </ul>
              <Button asChild className="w-full">
                <Link href="/interview">Start practising now</Link>
              </Button>
            </div>

            {/* Recruiter CTA card */}
            <div className="rounded-2xl border border-emerald-500/20 bg-card p-8 space-y-4 shadow-md">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10">
                <Building2 className="h-6 w-6 text-emerald-500" />
              </div>
              <h3 className="text-xl font-bold">Ready to hire smarter?</h3>
              <p className="text-sm text-muted-foreground">
                Post a job, bulk-upload CVs, and get a scored and ranked shortlist in minutes — plus
                AI-generated interview questions for every candidate.
              </p>
              <ul className="space-y-1.5">
                {["Auto CV parsing (PDF & DOCX)", "0–100 candidate match score", "One-click AI interview questions"].map((p) => (
                  <li key={p} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    {p}
                  </li>
                ))}
              </ul>
              <Button asChild variant="outline" className="w-full border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10">
                <Link href="/recruiter">Set up recruiter account</Link>
              </Button>
            </div>

          </div>
        </div>
      </section>

    </div>
  );
}
