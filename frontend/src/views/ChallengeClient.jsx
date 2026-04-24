"use client";
import { useSearchParams, useRouter } from "next/navigation";
import { useState } from "react";
import NavBar from "@/components/NavBar";
import DifficultySelector from "@/components/DifficultySelector";
import Footer from "@/components/Footer";
import { useI18n } from "@/contexts/I18nContext";

export default function ChallengeClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useI18n();

  const artist  = searchParams.get("artist") ?? "";
  const title   = searchParams.get("title") ?? "";
  const album   = searchParams.get("album") ?? "";
  const cover   = searchParams.get("cover") ?? "";
  const from    = searchParams.get("from") ?? "";
  const challengeScore = String(Math.max(0, Math.min(100, parseInt(searchParams.get("challenge_score") ?? "0", 10) || 0)));
  const challengeTotal = String(Math.max(0, parseInt(searchParams.get("challenge_total") ?? "0", 10) || 0));
  const difficulty = searchParams.get("difficulty") ?? "medium";

  const mode = "flow";

  if (!artist || !title) {
    router.replace("/");
    return null;
  }

  function handleAccept() {
    const p = new URLSearchParams({
      artist, title, difficulty, mode,
      challenge_score: challengeScore,
      challenge_total: challengeTotal,
    });
    if (album) p.set("album", album);
    if (cover) p.set("cover", cover);
    if (from)  p.set("from", from);
    router.push(`/game?${p}`);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />

      <main className="flex-1 max-w-sm mx-auto w-full px-4 py-12 flex flex-col gap-8">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{t("challenge.title")}</span>
          <h1 className="text-xl font-semibold tracking-tight">
            {from ? `${from} te lance un défi` : t("challenge.generic")}
          </h1>
        </div>

        {/* Song card */}
        <div className="border border-border flex items-center gap-3 px-3 py-3">
          {cover
            ? <img src={cover} alt={title} width={48} height={48} className="w-12 h-12 object-cover border border-border shrink-0" />
            : <div className="w-12 h-12 border border-border shrink-0 bg-secondary" />
          }
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-sm font-medium truncate">{title}</span>
            <span className="text-xs text-muted-foreground truncate">{artist}</span>
          </div>
        </div>

        {/* Score to beat */}
        <div className="border border-border px-4 py-4 flex flex-col items-center gap-1">
          <span className="text-3xl font-bold tabular-nums">{challengeScore}%</span>
          <span className="text-xs text-muted-foreground">
            {from ? `score de ${from}` : t("challenge.score.label")} · {challengeTotal} {t("challenge.words")}
          </span>
        </div>

        <button
          onClick={handleAccept}
          className="w-full h-10 border border-foreground bg-foreground text-background text-sm font-medium hover:bg-foreground/85 transition-colors"
        >
          {t("challenge.accept")}
        </button>

        <button
          onClick={() => router.push("/")}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
        >
          {t("challenge.ignore")}
        </button>
      </main>

      <Footer />
    </div>
  );
}
