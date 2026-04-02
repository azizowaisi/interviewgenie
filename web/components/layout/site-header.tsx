import Link from "next/link";
import { auth0 } from "@/lib/auth0";
import { Button } from "@/components/ui/button";
import { getPublicAppOriginForRequest } from "@/lib/public-app-origin";
import { getPublicAppOriginFromEnv } from "@/lib/site-url";
import { MobileNav } from "@/components/layout/mobile-nav";
import { MAIN_NAV_LINKS } from "@/components/layout/nav-links";

async function safeSession(): Promise<{ loggedIn: boolean; email?: string | null; name?: string | null }> {
  try {
    const session = await auth0.getSession();
    return {
      loggedIn: Boolean(session?.user?.sub),
      email: session?.user?.email ?? null,
      name: (session?.user?.name as string | undefined) ?? null,
    };
  } catch {
    // Misconfigured Auth0 (missing secret, etc.) must not white-screen the whole app.
    return { loggedIn: false };
  }
}

export async function SiteHeader() {
  const { loggedIn, email, name } = await safeSession();
  // Prefer explicit env in production to avoid proxy header quirks.
  const appBaseUrl = getPublicAppOriginFromEnv() || (await getPublicAppOriginForRequest());
  const logoutReturnTo = appBaseUrl ? `${appBaseUrl}/` : "";
  const logoutHref = logoutReturnTo
    ? `/auth/logout?returnTo=${encodeURIComponent(logoutReturnTo)}`
    : "/auth/logout";

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/80 backdrop-blur-md">
      <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 items-center gap-2">
          <MobileNav loggedIn={loggedIn} logoutHref={logoutHref} />
          <Link href="/" className="text-lg font-semibold tracking-tight text-foreground">
            Interview<span className="text-primary">Genie</span>
          </Link>
        </div>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {MAIN_NAV_LINKS.map(({ href, label }, i) => (
            <Button
              key={href}
              variant="ghost"
              size="sm"
              className={i === MAIN_NAV_LINKS.length - 1 ? "hidden lg:inline-flex" : undefined}
              asChild
            >
              <Link href={href} prefetch={false}>
                {label}
              </Link>
            </Button>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          {loggedIn ? (
            <>
              <Button variant="ghost" size="sm" className="max-w-[260px]" asChild>
                <Link href="/profile" className="flex items-center gap-2">
                  <span className="bg-primary text-primary-foreground inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold uppercase">
                    {(name?.trim()?.[0] ?? email?.trim()?.[0] ?? "U").toUpperCase()}
                  </span>
                  <span className="truncate text-sm">{email ?? "Profile"}</span>
                </Link>
              </Button>
              <Button variant="secondary" size="sm" asChild>
                <a href={logoutHref}>Log out</a>
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
