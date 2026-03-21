import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "InterviewGenie — AI Interview Assistant",
  description: "Practice and improve interviews using AI. ATS analysis, mock interviews, and feedback.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
