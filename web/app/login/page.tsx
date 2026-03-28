import Link from "next/link";
import { redirect } from "next/navigation";

type Search = {
  readonly returnTo?: string;
  readonly screen_hint?: string;
  readonly error_description?: string;
};

export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const returnTo = sp.returnTo || "/interview";

  if (sp.error_description?.trim()) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center gap-6 px-4 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Sign-in did not complete</h1>
        <p className="text-muted-foreground text-sm leading-relaxed whitespace-pre-wrap">
          {sp.error_description}
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/auth/login?${new URLSearchParams({
              returnTo,
              ...(sp.screen_hint ? { screen_hint: sp.screen_hint } : {}),
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
  if (sp.screen_hint) query.set("screen_hint", sp.screen_hint);
  redirect(`/auth/login?${query.toString()}`);
}
