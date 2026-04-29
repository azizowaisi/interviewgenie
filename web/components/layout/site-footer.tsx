export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-secondary/20 py-10 text-center text-sm text-muted-foreground">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4">
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-3">
          <p>© {new Date().getFullYear()} InterviewGenie.</p>
        </div>
      </div>
    </footer>
  );
}
