"use client";
import { useI18n } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";

function ToggleRow({ label, items, value, onChange }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{label}</span>
      <div className="flex border border-border overflow-hidden">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            className={cn(
              "flex-1 py-2 px-2 text-xs transition-colors text-center border-r border-border last:border-r-0",
              value === item.id ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-accent"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function DifficultySelector({ difficulty, onDifficulty, mode, onMode }) {
  const { t } = useI18n();

  const DIFFICULTIES = [
    { id: "easy",    label: t("diff.easy") },
    { id: "medium",  label: t("diff.medium") },
    { id: "hard",    label: t("diff.hard") },
    { id: "extreme", label: t("diff.extreme") },
  ];

  const MODES = [
    { id: "normal", label: t("mode.normal") },
    { id: "flow",   label: t("mode.flow") },
  ];

  return (
    <div className="flex flex-col gap-4">
      <ToggleRow label={t("diff.label")} items={DIFFICULTIES} value={difficulty} onChange={onDifficulty} />
      <ToggleRow label={t("mode.label")} items={MODES} value={mode} onChange={onMode} />
    </div>
  );
}
