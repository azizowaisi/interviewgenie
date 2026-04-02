"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAIN_NAV_LINKS } from "@/components/layout/nav-links";

type Props = {
  readonly loggedIn: boolean;
  readonly logoutHref: string;
};

export function MobileNav({ loggedIn, logoutHref }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <Button
        type="button"
        variant="ghost"
        className="h-9 w-9 shrink-0 p-0 shadow-none"
        aria-expanded={open}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>
      {open ? (
        <div
          className="absolute left-0 right-0 top-full z-50 border-b border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur-md"
          role="dialog"
          aria-label="Site navigation"
        >
          <nav className="flex flex-col gap-1">
            {loggedIn
              ? MAIN_NAV_LINKS.map(({ href, label }) => (
                  <Link
                    key={href}
                    href={href}
                    prefetch={false}
                    className="text-foreground hover:bg-accent rounded-md px-3 py-2 text-sm font-medium"
                    onClick={() => setOpen(false)}
                  >
                    {label}
                  </Link>
                ))
              : null}
            <div className="border-border mt-2 border-t pt-2">
              {loggedIn ? (
                <a
                  href={logoutHref}
                  className="text-foreground hover:bg-accent block rounded-md px-3 py-2 text-sm font-medium"
                  onClick={() => setOpen(false)}
                >
                  Log out
                </a>
              ) : (
                <Link
                  href="/login"
                  className="text-foreground hover:bg-accent block rounded-md px-3 py-2 text-sm font-medium"
                  onClick={() => setOpen(false)}
                >
                  Sign in
                </Link>
              )}
            </div>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
