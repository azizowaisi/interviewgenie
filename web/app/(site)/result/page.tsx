import { Suspense } from "react";
import { ResultView } from "@/components/interview/result-view";

export default function ResultPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 md:py-16">
      <Suspense fallback={<p className="text-center text-muted-foreground">Loading…</p>}>
        <ResultView />
      </Suspense>
    </div>
  );
}
