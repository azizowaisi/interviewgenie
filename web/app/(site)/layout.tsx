import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { RequireAuth } from "@/components/auth/require-auth";

export default function SiteLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="min-h-[calc(100vh-8rem)]">
        <RequireAuth>{children}</RequireAuth>
      </main>
      <SiteFooter />
    </>
  );
}
