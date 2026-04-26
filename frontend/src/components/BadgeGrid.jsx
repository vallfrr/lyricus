"use client";
import {
  Music, Music2, Flame, CalendarCheck, CalendarDays, CircleCheck, Zap, Gem, Target,
  Mic, Headphones, Trophy, Star, Crown, Shield, Swords, Sun, Moon, Medal, Award, Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const ICON_MAP = {
  Music, Music2, Flame, CalendarCheck, CalendarDays, CircleCheck, Zap, Gem, Target,
  Mic, Headphones, Trophy, Star, Crown, Shield, Swords, Sun, Moon, Medal, Award, Wand2,
};

export default function BadgeGrid({ badges }) {
  if (!badges?.length) return null;

  return (
    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
      {badges.map((badge) => {
        const Icon = ICON_MAP[badge.icon] ?? Star;
        return (
          <div
            key={badge.id}
            title={`${badge.label} — ${badge.desc}${badge.earned_at ? `\n${new Date(badge.earned_at).toLocaleDateString()}` : ""}`}
            className={cn(
              "flex flex-col items-center gap-1.5 p-2 border border-border transition-colors",
              badge.earned
                ? "text-foreground"
                : "text-muted-foreground/30 border-border/40"
            )}
          >
            <Icon size={20} strokeWidth={1.5} />
            <span className="text-[9px] text-center leading-tight truncate w-full text-center">
              {badge.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
