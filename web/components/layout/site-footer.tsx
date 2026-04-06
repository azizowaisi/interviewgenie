import Image from "next/image";
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
    <footer className="border-t border-border bg-secondary/20 py-10 text-center text-sm text-muted-foreground">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4">
        <nav className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2" aria-label="Footer">
          {nav.map(({ href, label }, index) => (
            <div key={href} className="flex items-center gap-3">
              {index > 0 ? <span aria-hidden="true" className="text-border">|</span> : null}
              <Link href={href} prefetch={false} className="uppercase tracking-[0.18em] hover:text-foreground">
                {label}
              </Link>
            </div>
          ))}
        </nav>
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-3">
          <p>© {new Date().getFullYear()} InterviewGenie. A project of Teckiz.</p>
          <a
            href="https://teckiz.com/website/"
            target="_blank"
            rel="noreferrer"
            className="transition-opacity hover:opacity-90"
            aria-label="Teckiz"
          >
            <Image
              src="/brand/teckiz-logo.png"
              alt="Teckiz"
              width={120}
              height={40}
              className="h-8 w-auto"
            />
          </a>
        </div>
      </div>
    </footer>
  );
}
