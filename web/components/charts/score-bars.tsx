"use client";

import { cn } from "@/lib/utils";

type Item = { label: string; value: number; max?: number };

export function ScoreBars({ items, className }: { items: Item[]; className?: string }) {
  return (
    <div className={cn("grid gap-4", className)}>
      {items.map((item) => {
        const max = item.max ?? 100;
        const pct = Math.min(100, Math.max(0, (item.value / max) * 100));
        return (
          <div key={item.label} className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{item.label}</span>
              <span>{Math.round(item.value)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
