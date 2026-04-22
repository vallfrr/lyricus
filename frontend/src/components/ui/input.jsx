"use client";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const Input = forwardRef(({ className, type, ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      "flex h-9 w-full border border-border bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground disabled:opacity-40 transition-colors",
      className
    )}
    {...props}
  />
));
Input.displayName = "Input";

export { Input };
