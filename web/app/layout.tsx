import type { Metadata } from "next";
import "./globals.css";

import { getPublicAppOriginFromEnv } from "@/lib/site-url";

function safeMetadataBase() {
  const origin = getPublicAppOriginFromEnv();
  if (!origin) return undefined;
  try {
    return new URL(origin);
  } catch {
    return undefined;
  }
}

export const metadata: Metadata = {
  title: {
    default: "InterviewGenie | AI Mock Interview Practice and ATS Resume Checker",
    template: "%s | InterviewGenie",
  },
  description:
    "InterviewGenie helps candidates pass interviews with AI mock interviews, ATS resume checks, STAR feedback, and role-specific practice. Recruiters can screen CVs, rank candidates, and generate interview questions in minutes.",
  keywords: [
    "AI interview assistant",
    "mock interview practice",
    "ATS resume checker",
    "resume ATS score",
    "STAR interview answers",
    "technical interview practice",
    "HR interview practice",
    "behavioral interview practice",
    "job interview preparation",
    "AI recruiter tools",
    "candidate screening software",
    "CV parser",
    "resume parser",
    "candidate ranking software",
    "interview question generator",
    "hiring workflow software",
  ],
  metadataBase: safeMetadataBase(),
  applicationName: "InterviewGenie",
  category: "Career and Recruiting Software",
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION,
  },
  openGraph: {
    title: "InterviewGenie | AI Mock Interview Practice and ATS Resume Checker",
    description:
      "Practice technical and HR interviews with AI, improve ATS resume match scores, and get actionable feedback. Recruiters can parse CVs and shortlist faster.",
    url: "/",
    siteName: "InterviewGenie",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "InterviewGenie | AI Interview and ATS Platform",
    description:
      "AI mock interviews, ATS resume optimization, and recruiter candidate screening in one platform.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
