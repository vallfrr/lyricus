"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";

function normalize(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function fmt(iso) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function fmtDur(s) {
  if (!s) return "—";
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}


const DIFF_COLOR = {
  easy: "text-green-500", medium: "text-yellow-500",
  hard: "text-orange-500", extreme: "text-red-500",
};

function cleanArtist(artist) {
  return artist.split(/\s+(?:feat\.?|ft\.?|with)\s+/i)[0].trim();
}

function getInProgressGames() {
  const games = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith("lyricusProgress_")) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const data = JSON.parse(raw);
      if (!data.artist || !data.title) continue;
      if (Date.now() - data.savedAt > 7 * 24 * 3600 * 1000) { localStorage.removeItem(key); continue; }
      games.push({ _key: key, ...data });
    }
  } catch {}
  return games.sort((a, b) => b.savedAt - a.savedAt);
}

export default function HistoryClient() {
  const { user, loading: authLoading } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inProgress, setInProgress] = useState([]);
  const [search, setSearch] = useState("");

  const DIFF_LABELS = {
    easy: t("diff.easy"), medium: t("diff.medium"),
    hard: t("diff.hard"), extreme: t("diff.extreme"),
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace("/"); return; }

    const localGames = getInProgressGames();

    // Fetch both finished history and unfinished DB sessions in parallel
    Promise.all([
      fetch("/api/history/", { credentials: "include" }).then((r) => r.json()).catch(() => []),
      fetch("/api/history/unfinished", { credentials: "include" }).then((r) => r.json()).catch(() => []),
    ]).then(([finished, dbUnfinished]) => {
      setHistory(finished);

      // Merge DB unfinished with localStorage — deduplicate by (artist, title, difficulty, mode)
      const dbKeys = new Set(
        dbUnfinished.map((g) => `${g.artist}|${g.title}|${g.difficulty}|${g.mode}`)
      );
      const localOnly = localGames.filter(
        (g) => !dbKeys.has(`${g.artist}|${g.title}|${g.difficulty}|${g.mode}`)
      );
      // DB sessions come first (they have a real id), then local-only ones
      const merged = [
        ...dbUnfinished.map((g) => ({ ...g, _key: null, _fromDb: true })),
        ...localOnly,
      ];
      setInProgress(merged);
    }).finally(() => setLoading(false));
  }, [user, authLoading]);

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8">
        <h1 className="text-xl font-semibold tracking-tight mb-6">{t("history.title")}</h1>

        {/* In-progress games */}
        {inProgress.length > 0 && (
          <div className="flex flex-col gap-2 mb-6">
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{t("history.inprogress")}</span>
            <div className="border border-border">
              {inProgress.map((g) => {
                let revealedCount = 0;
                let totalCount = 0;
                if (g.type === "flow" && g.total > 0) {
                  revealedCount = g.revealed_ids?.length ?? g.revealed?.length ?? 0;
                  totalCount = g.total;
                } else if (g.type === "normal" && g.answers) {
                  revealedCount = Object.keys(g.answers).filter(k => g.answers[k]?.trim()).length;
                  totalCount = Math.max(Object.keys(g.answers).length, 1);
                }
                const progressStr = totalCount > 0 ? `${revealedCount}/${totalCount}` : null;
                const timerStr = g.timer ? fmtDur(g.timer) : null;

                return (
                  <div key={g._key} className="flex items-center gap-3 px-3 py-2.5 border-b border-border last:border-0">
                    {g.cover
                      ? <img src={g.cover} alt={g.title} width={32} height={32} className="w-8 h-8 object-cover border border-border shrink-0" />
                      : <div className="w-8 h-8 border border-border bg-secondary shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{g.title}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        <Link href={`/artist/${encodeURIComponent(cleanArtist(g.artist))}`} className="hover:underline">{g.artist}</Link>
                        {" · "}{DIFF_LABELS[g.difficulty] ?? g.difficulty}
                      </p>
                    </div>
                    {(progressStr || timerStr) && (
                      <div className="flex items-center gap-2 shrink-0">
                        {progressStr && <span className="text-[10px] text-muted-foreground tabular-nums">{progressStr}</span>}
                        {timerStr && <span className="text-[10px] text-muted-foreground tabular-nums">{timerStr}</span>}
                      </div>
                    )}
                    <button
                      onClick={() => {
                        const p = new URLSearchParams({ artist: g.artist, title: g.title, difficulty: g.difficulty, mode: "flow" });
                        if (g.cover) p.set("cover", g.cover);
                        // For DB sessions, pass session_id so GameClient reuses stored tokens
                        if (g._fromDb && g.id) p.set("session_id", g.id);
                        router.push(`/game?${p}`);
                      }}
                      className="text-[10px] border border-foreground px-2.5 py-1 hover:bg-foreground hover:text-background transition-colors shrink-0"
                    >
                      {t("history.resume")}
                    </button>
                    <button
                      onClick={() => {
                        if (g._fromDb && g.id) {
                          fetch(`/api/history/${g.id}`, { method: "DELETE", credentials: "include" }).catch(() => {});
                          setInProgress((prev) => prev.filter((x) => x.id !== g.id));
                        } else {
                          try { localStorage.removeItem(g._key); } catch {}
                          setInProgress((prev) => prev.filter((x) => x._key !== g._key));
                        }
                      }}
                      className="text-[10px] border border-border px-2 py-1 text-muted-foreground hover:border-foreground hover:text-foreground transition-colors shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {loading && <p className="text-xs text-muted-foreground text-center py-20">{t("history.loading")}</p>}
        {!loading && history.length === 0 && inProgress.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-20">{t("history.empty")}</p>
        )}

        {!loading && history.length > 0 && (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("history.search")}
              className="w-full h-8 px-3 text-xs bg-background text-foreground placeholder:text-muted-foreground border border-border focus:outline-none focus:border-foreground transition-colors"
            />
          <div className="border border-border">
            {history.filter((g) => {
              const q = normalize(search.trim());
              if (!q) return true;
              return normalize(g.title).includes(q) || normalize(g.artist).includes(q);
            }).map((g) => {
              const pct = g.score_total > 0 ? Math.round(g.score_correct * 100 / g.score_total) : 0;
              const mainArtist = cleanArtist(g.artist);
              return (
                <div
                  key={g.id}
                  className="grid grid-cols-[auto_1fr_6rem_4rem_4rem] items-center gap-0 border-b border-border last:border-0 hover:bg-accent transition-colors cursor-pointer"
                  onClick={() => {
                    const p = new URLSearchParams({ artist: g.artist, title: g.title });
                    if (g.album) p.set("album", g.album);
                    if (g.cover) p.set("cover", g.cover);
                    router.push(`/?${p}`);
                  }}
                >
                  {/* Cover */}
                  <div className="p-2 shrink-0">
                    {g.cover
                      ? <img src={g.cover} alt={g.title} width={32} height={32} className="w-8 h-8 object-cover border border-border" />
                      : <div className="w-8 h-8 border border-border bg-secondary" />
                    }
                  </div>
                  {/* Song info */}
                  <div className="px-2 py-2.5 min-w-0">
                    <p className="text-xs font-medium truncate">{g.title}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      <Link
                        href={`/artist/${encodeURIComponent(mainArtist)}`}
                        className="hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {g.artist}
                      </Link>
                      {" · "}{fmt(g.played_at)}
                    </p>
                  </div>
                  {/* Diff */}
                  <div className={cn("px-2 py-2.5 text-xs tabular-nums", DIFF_COLOR[g.difficulty] ?? "text-muted-foreground")}>
                    {DIFF_LABELS[g.difficulty] ?? g.difficulty}
                  </div>
                  {/* Score */}
                  <div className="px-2 py-2.5 text-xs tabular-nums font-medium">{pct}%</div>
                  {/* Duration */}
                  <div className="px-2 py-2.5 text-xs text-muted-foreground tabular-nums">{fmtDur(g.duration_seconds)}</div>
                </div>
              );
            })}
          </div>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
