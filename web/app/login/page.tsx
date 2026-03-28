import Link from "next/link";
import { redirect } from "next/navigation";

type Search = {
  readonly returnTo?: string;
  readonly screen_hint?: string;
  readonly error_description?: string;
};

export default function LoginPage({ searchParams }: { readonly searchParams: Search }) {
  const returnTo = searchParams.returnTo || "/interview";

  if (searchParams.error_description?.trim()) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center gap-6 px-4 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Sign-in did not complete</h1>
        <p className="text-muted-foreground text-sm leading-relaxed whitespace-pre-wrap">
          {searchParams.error_description}
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/auth/login?${new URLSearchParams({
              returnTo,
              ...(searchParams.screen_hint ? { screen_hint: searchParams.screen_hint } : {}),
            })}`}
            className="bg-primary text-primary-foreground inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium"
          >
            Try again
          </Link>
          <Link href="/" className="text-muted-foreground inline-flex h-9 items-center px-2 text-sm underline-offset-4 hover:underline">
            Home
          </Link>
        </div>
      </div>
    );
  }

  const query = new URLSearchParams({ returnTo });
  if (searchParams.screen_hint) query.set("screen_hint", searchParams.screen_hint);
  redirect(`/auth/login?${query.toString()}`);
}
