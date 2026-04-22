"use client";
import { useAudio } from "@/contexts/AudioContext";
import { cn } from "@/lib/utils";

export default function PreviewButton({ url, className = "" }) {
  const { playing, toggle } = useAudio();
  if (!url) return null;

  const active = playing === url;

  return (
    <button
      onClick={(e) => { e.stopPropagation(); toggle(url); }}
      className={cn(
        "text-[10px] px-1.5 py-0.5 border transition-colors",
        active
          ? "border-foreground text-foreground"
          : "border-border text-muted-foreground hover:border-foreground hover:text-foreground",
        className
      )}
      title={active ? "arrêter" : "écouter 30s"}
    >
      {active ? "■" : "▶"}
    </button>
  );
}
