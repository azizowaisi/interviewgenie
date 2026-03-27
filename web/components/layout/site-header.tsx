import Link from "next/link";
import { auth0 } from "@/lib/auth0";
import { Button } from "@/components/ui/button";
import { getPublicAppOriginForRequest } from "@/lib/public-app-origin";
import { getPublicAppOriginFromEnv } from "@/lib/site-url";

export async function SiteHeader() {
  const session = await auth0.getSession();
  const loggedIn = !!session?.user?.sub;
  // Prefer explicit env in production to avoid proxy header quirks.
  const appBaseUrl = getPublicAppOriginFromEnv() || (await getPublicAppOriginForRequest());
  const logoutReturnTo = appBaseUrl ? `${appBaseUrl}/` : "";
  const logoutHref = logoutReturnTo
    ? `/auth/logout?returnTo=${encodeURIComponent(logoutReturnTo)}`
    : "/auth/logout";

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 p-4">
        <Link href="/" className="text-lg font-semibold tracking-tight text-foreground">
          Interview<span className="text-primary">Genie</span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/interview" prefetch={false}>
              Start
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/upload" prefetch={false}>
              ATS
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/mock" prefetch={false}>
              Mock
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/live" prefetch={false}>
              Live
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/history" prefetch={false}>
              History
            </Link>
          </Button>
          <Button variant="ghost" size="sm" className="hidden lg:inline-flex" asChild>
            <Link href="/#desktop-app" prefetch={false}>
              Download app
            </Link>
          </Button>
        </nav>
        <div className="flex items-center gap-2">
          {loggedIn ? (
            <Button variant="secondary" size="sm" asChild>
              {/* Full navigation — OAuth logout redirects must not be SPA-soft-navigated */}
              <a href={logoutHref}>Log out</a>
            </Button>
          ) : (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
          )}
          <Button size="sm" className="hidden sm:inline-flex" asChild>
            <Link href="/interview" prefetch={false}>
              Start
            </Link>
          </Button>
          <Button size="sm" variant="secondary" asChild>
            <Link href="/mock" prefetch={false}>
              Mock
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
