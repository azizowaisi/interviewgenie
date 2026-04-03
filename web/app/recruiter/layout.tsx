import { SiteHeader } from "@/components/layout/site-header";
import { RequireAuth } from "@/components/auth/require-auth";

export default function RecruiterLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="min-h-[calc(100vh-4rem)] bg-background">
        <RequireAuth>{children}</RequireAuth>
      </main>
    </>
  );
}
