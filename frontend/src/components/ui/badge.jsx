"use client";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }) {
  return (
    <span
      className={cn(
        "inline-flex items-center border border-border px-2 py-0.5 text-xs font-mono text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}
