"use client";
import { useState, useRef, useEffect } from "react";
import { Palette } from "lucide-react";
import { useTheme, THEMES } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

export default function ThemeToggle({ className }) {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClick(e) {
      if (!ref.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="changer le thème"
        className={cn(
          "h-7 w-7 flex items-center justify-center border border-border text-muted-foreground hover:border-foreground hover:text-foreground transition-colors",
          open && "border-foreground text-foreground",
          className
        )}
      >
        <Palette size={13} />
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-50 w-56 border border-border bg-background p-2 flex flex-col gap-0.5 shadow-lg">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTheme(t.id); setOpen(false); }}
              className={cn(
                "flex items-center gap-2.5 px-2 py-1.5 text-xs text-left hover:bg-accent transition-colors",
                theme === t.id && "bg-accent"
              )}
            >
              <span
                className="w-4 h-4 border border-border shrink-0 flex items-center justify-center"
                style={{ background: t.bg }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.accent }} />
              </span>
              <span className={cn("flex-1", theme === t.id ? "text-foreground" : "text-muted-foreground")}>
                {t.label}
              </span>
              {theme === t.id && <span className="text-foreground">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
