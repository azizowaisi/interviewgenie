import Link from "next/link";
import { HistoryTable } from "@/components/interview/history-table";
import { Button } from "@/components/ui/button";

export default function HistoryPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 md:py-16">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold md:text-3xl">Interview history</h1>
        <Button variant="outline" asChild>
          <Link href="/interview">Start page</Link>
        </Button>
      </div>
      <HistoryTable />
    </div>
  );
}
