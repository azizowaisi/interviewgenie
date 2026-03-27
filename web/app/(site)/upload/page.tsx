import Link from "next/link";
import { Button } from "@/components/ui/button";
import { UploadAnalyze } from "@/components/interview/upload-analyze";

export default function UploadPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 md:py-16">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold md:text-3xl">ATS results</h1>
        <Button variant="outline" asChild>
          <Link href="/interview">Back to Start</Link>
        </Button>
      </div>
      <UploadAnalyze />
    </div>
  );
}
