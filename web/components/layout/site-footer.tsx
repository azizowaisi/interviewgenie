import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-border py-10 text-center text-sm text-muted-foreground">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 md:flex-row md:justify-between">
        <p>© {new Date().getFullYear()} InterviewGenie. AI interview practice.</p>
        <div className="flex gap-4">
          <Link href="/interview" className="hover:text-foreground">
            Interview
          </Link>
          <Link href="/admin" className="hover:text-foreground">
            Admin
          </Link>
        </div>
      </div>
    </footer>
  );
}
