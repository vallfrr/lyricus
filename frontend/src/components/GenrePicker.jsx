"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const MAIN_NAMES = ["Pop", "Rap/Hip Hop", "Hip Hop", "Rock", "Électronique", "Electronic", "R&B"];

export default function GenrePicker({ onSelect, loading: parentLoading }) {
  const [genres, setGenres] = useState([]);
  const [loadingGenres, setLoadingGenres] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    fetch("/api/genres")
      .then((r) => r.json())
      .then(setGenres)
      .catch(() => {})
      .finally(() => setLoadingGenres(false));
  }, []);

  if (loadingGenres) return <p className="text-xs text-muted-foreground">chargement...</p>;

  const main = genres.filter((g) => MAIN_NAMES.some((n) => g.name.toLowerCase().includes(n.toLowerCase())));
  const rest = genres.filter((g) => !main.includes(g));

  const visible = showAll ? genres : main;

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((g) => (
        <button
          key={g.id}
          onClick={() => { setSelected(g.id); onSelect(g); }}
          disabled={parentLoading}
          className={cn(
            "px-2 py-1 text-xs border transition-colors disabled:opacity-40",
            selected === g.id
              ? "border-foreground bg-foreground text-background"
              : "border-border text-foreground hover:border-foreground"
          )}
        >
          {g.name}
        </button>
      ))}
      {rest.length > 0 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="px-2 py-1 text-xs border border-dashed border-border text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
        >
          {showAll ? "−" : `+ ${rest.length}`}
        </button>
      )}
    </div>
  );
}
