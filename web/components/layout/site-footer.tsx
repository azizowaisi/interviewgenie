import Image from "next/image";
import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-secondary/20 py-10 text-center text-sm text-muted-foreground">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4">
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
