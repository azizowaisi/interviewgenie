import { RecruiterHeader } from "@/components/layout/recruiter-header";
import { RequireAuth } from "@/components/auth/require-auth";

export default function RecruiterLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <>
      <RecruiterHeader />
      <main className="min-h-[calc(100vh-4rem)] bg-background">
        <RequireAuth>{children}</RequireAuth>
      </main>
    </>
  );
}
