import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Mic, BarChart3, Users, Sparkles, Zap, LineChart, MessageSquare, Target, Shield } from "lucide-react";

const features = [
  "Real-time interview simulation",
  "ATS score analysis",
  "HR & Technical interview modes",
  "Live AI answers",
  "Performance evaluation",
  "Retake interviews",
];

const steps = [
  "Upload CV",
  "Paste Job Description",
  "Get ATS Score",
  "Start Interview",
  "Get Feedback",
  "Improve with Retakes",
];

export default function LandingPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-20 px-4 py-16 md:py-24">
      <section className="grid gap-10 lg:grid-cols-2 lg:items-center">
        <div className="space-y-6">
          <Badge variant="secondary" className="w-fit">
            AI Interview Assistant
          </Badge>
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl lg:text-6xl">
            AI Interview Assistant
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            Practice and improve interviews using AI — realistic mock sessions, ATS insights, and actionable
            feedback.
          </p>
          <div className="flex flex-wrap gap-4">
            <Button size="lg" asChild>
              <Link href="/interview" prefetch={false}>
                Start Interview
              </Link>
            </Button>
            <Button size="lg" variant="secondary" asChild>
              <Link href="/upload" prefetch={false}>
                Analyze CV
              </Link>
            </Button>
          </div>
        </div>
        <Card className="border-primary/20 bg-gradient-to-br from-card to-secondary/30 p-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-medium">
              <Sparkles className="h-4 w-4 text-primary" />
              Ready when you are
            </CardTitle>
            <CardDescription>
              Same product in the browser or as a desktop app — one account everywhere.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-background/50 p-4 shadow-md">
              <Mic className="mb-2 h-5 w-5 text-primary" />
              <p className="text-sm font-medium">Mock interviews</p>
              <p className="text-xs text-muted-foreground">Timed sessions with AI-generated questions</p>
            </div>
            <div className="rounded-xl bg-background/50 p-4 shadow-md">
              <BarChart3 className="mb-2 h-5 w-5 text-primary" />
              <p className="text-sm font-medium">ATS & scoring</p>
              <p className="text-xs text-muted-foreground">Skill match and gap analysis</p>
            </div>
            <div className="rounded-xl bg-background/50 p-4 shadow-md">
              <Users className="mb-2 h-5 w-5 text-primary" />
              <p className="text-sm font-medium">HR & Technical</p>
              <p className="text-xs text-muted-foreground">Pick the mode that fits your role</p>
            </div>
            <div className="rounded-xl bg-background/50 p-4 shadow-md">
              <Shield className="mb-2 h-5 w-5 text-primary" />
              <p className="text-sm font-medium">Private by design</p>
              <p className="text-xs text-muted-foreground">Your CV and sessions stay under your control</p>
            </div>
          </CardContent>
        </Card>
      </section>

      <Separator />

      <section className="space-y-8">
        <div>
          <h2 className="text-2xl font-semibold md:text-3xl">Features</h2>
          <p className="mt-2 text-muted-foreground">Everything you need to prepare like a pro.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => {
            const Icon = [Zap, LineChart, Users, MessageSquare, Target, Mic][i] ?? Sparkles;
            return (
              <Card key={f} className="shadow-md">
                <CardContent className="flex items-start gap-3 p-4">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <p className="text-sm font-medium leading-snug">{f}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-8">
        <div>
          <h2 className="text-2xl font-semibold md:text-3xl">How it works</h2>
          <p className="mt-2 text-muted-foreground">Six simple steps from CV to confidence.</p>
        </div>
        <ol className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {steps.map((label, i) => (
            <li key={label}>
              <Card className="h-full shadow-md">
                <CardContent className="flex gap-4 p-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-medium">{label}</p>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <Separator />
    </div>
  );
}
