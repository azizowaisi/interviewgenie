import Link from "next/link";

export function SiteFooter() {
  const nav = [
    { href: "/interview", label: "Start" },
    { href: "/upload", label: "ATS" },
    { href: "/mock", label: "Mock" },
    { href: "/live", label: "Live" },
    { href: "/history", label: "History" },
  ] as const;

  return (
    <footer className="border-t border-border py-10 text-center text-sm text-muted-foreground">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 md:flex-row md:justify-between">
        <p>© {new Date().getFullYear()} InterviewGenie. AI interview practice.</p>
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2" aria-label="Footer">
          {nav.map(({ href, label }) => (
            <Link key={href} href={href} prefetch={false} className="hover:text-foreground">
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
