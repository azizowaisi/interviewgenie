import { redirect } from "next/navigation";

export default function LoginPage({
  searchParams,
}: {
  readonly searchParams: { readonly returnTo?: string; readonly screen_hint?: string };
}) {
  const returnTo = searchParams.returnTo || "/interview";
  const query = new URLSearchParams({ returnTo });
  if (searchParams.screen_hint) query.set("screen_hint", searchParams.screen_hint);
  redirect(`/auth/login?${query.toString()}`);
}

