import Link from "next/link";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 p-4">
        <Link href="/" className="text-lg font-semibold tracking-tight text-foreground">
          Interview<span className="text-primary">Genie</span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/interview">Interview</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/upload">ATS</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/history">History</Link>
          </Button>
        </nav>
        <div className="flex items-center gap-2">
          <Button size="sm" className="hidden sm:inline-flex" asChild>
            <Link href="/interview">Start Interview</Link>
          </Button>
          <Button size="sm" variant="secondary" asChild>
            <Link href="/upload">Analyze CV</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
