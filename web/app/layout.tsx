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
  title: "InterviewGenie — AI Interview Assistant",
  description: "Practice and improve interviews using AI. ATS analysis, mock interviews, and feedback.",
  metadataBase: safeMetadataBase(),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "InterviewGenie — AI Interview Assistant",
    description: "Practice and improve interviews using AI. ATS analysis, mock interviews, and feedback.",
    url: "/",
    siteName: "InterviewGenie",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "InterviewGenie — AI Interview Assistant",
    description: "Practice and improve interviews using AI. ATS analysis, mock interviews, and feedback.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
