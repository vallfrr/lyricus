"use client";
import { forwardRef } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center font-mono text-sm transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 border",
  {
    variants: {
      variant: {
        default:     "bg-foreground text-background border-foreground hover:bg-foreground/85",
        outline:     "bg-background text-foreground border-border hover:border-foreground",
        ghost:       "border-transparent text-foreground hover:bg-accent",
        secondary:   "bg-secondary text-foreground border-border hover:border-foreground",
        destructive: "bg-background text-foreground border-border hover:border-foreground",
      },
      size: {
        default: "h-9 px-4",
        sm:      "h-7 px-3 text-xs",
        lg:      "h-11 px-6",
        icon:    "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

const Button = forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
});
Button.displayName = "Button";

export { Button, buttonVariants };
