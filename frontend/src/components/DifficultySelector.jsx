"use client";
import { useI18n } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";

export default function DifficultySelector({ difficulty, onDifficulty }) {
  const { t } = useI18n();

  const DIFFICULTIES = [
    { id: "easy",    label: t("diff.easy") },
    { id: "medium",  label: t("diff.medium") },
    { id: "hard",    label: t("diff.hard") },
    { id: "extreme", label: t("diff.extreme") },
  ];

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{t("diff.label")}</span>
      <div className="flex border border-border overflow-hidden">
        {DIFFICULTIES.map((item) => (
          <button
            key={item.id}
            onClick={() => onDifficulty(item.id)}
            className={cn(
              "flex-1 py-2 px-2 text-xs transition-colors text-center border-r border-border last:border-r-0",
              difficulty === item.id ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-accent"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
