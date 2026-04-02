"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type MeResponse =
  | { loggedIn: false }
  | {
      loggedIn: true;
      user?: {
        sub?: string;
        email?: string;
        id?: string;
      } | null;
    };

const USER_ID_KEY = "ig_user_id";

export function RequireAuth({ children }: { readonly children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const shouldSkip = useMemo(() => {
    // Keep marketing landing public.
    return pathname === "/";
  }, [pathname]);

  const [status, setStatus] = useState<"checking" | "ready" | "redirecting">("checking");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (shouldSkip) {
        if (!cancelled) setStatus("ready");
        return;
      }

      setStatus("checking");
      try {
        const r = await fetch("/api/auth/me", { cache: "no-store" });
        const j = (await r.json()) as MeResponse;
        if (cancelled) return;

        if (!j.loggedIn) {
          setStatus("redirecting");
          const returnTo = pathname ?? "/interview";
          router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
          return;
        }

        // Ensure backend user entity exists for Auth0 users (email + language default).
        // This endpoint is idempotent and upserts on the api-service side.
        await fetch("/api/app/users/me", { cache: "no-store" }).catch(() => null);

        // Seed the existing X-User-Id plumbing with Auth0 stable `sub`.
        // Backend currently uses X-User-Id (Auth0 auth is optional for now), but this
        // keeps data consistent across sessions/devices for MVP.
        const sub = j.user?.sub;
        const stableId = sub ?? j.user?.id ?? j.user?.email;
        if (stableId) {
          const existing = localStorage.getItem(USER_ID_KEY);
          if (!existing) localStorage.setItem(USER_ID_KEY, stableId);
        }

        setStatus("ready");
      } catch {
        setStatus("redirecting");
        const returnTo = pathname ?? "/interview";
        router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [router, shouldSkip, pathname]);

  if (status === "checking" || status === "redirecting") {
    return (
      <div
        className="text-muted-foreground flex min-h-[40vh] flex-col items-center justify-center gap-2 px-4 text-sm"
        aria-busy="true"
        aria-live="polite"
      >
        <span className="border-primary h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" />
        <span>{status === "redirecting" ? "Redirecting to sign in…" : "Checking session…"}</span>
      </div>
    );
  }
  return <>{children}</>;
}

