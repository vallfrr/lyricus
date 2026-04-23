"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import { useI18n } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";

const PERIODS = [
  { id: "all",  key: "lb.period.all" },
  { id: "week", key: "lb.period.week" },
];

function Avatar({ name }) {
  const initials = (name || "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <span className="w-6 h-6 flex items-center justify-center border border-border text-[10px] font-medium shrink-0 bg-secondary">
      {initials}
    </span>
  );
}

function RankBadge({ rank }) {
  const colors = { 1: "text-yellow-500", 2: "text-zinc-400", 3: "text-amber-600" };
  return (
    <span className={cn("tabular-nums font-mono text-xs w-5 text-center", colors[rank] ?? "text-muted-foreground")}>
      {rank <= 3 ? ["🥇","🥈","🥉"][rank-1] : rank}
    </span>
  );
}

function Row({ row, youLabel }) {
  return (
    <div
      className={cn(
        "grid grid-cols-[2rem_1fr_4rem_4rem_5.5rem] border-b border-border last:border-0 transition-colors",
        row.is_me
          ? "bg-foreground/5 border-l-2 border-l-foreground"
          : "hover:bg-accent"
      )}
    >
      <div className="px-3 py-2.5 flex items-center">
        <RankBadge rank={row.rank} />
      </div>
      <div className="px-3 py-2.5 flex items-center gap-2 min-w-0">
        <Avatar name={row.name} />
        <Link
          href={`/u/${encodeURIComponent(row.name)}`}
          className={cn(
            "text-xs truncate hover:underline",
            row.is_me ? "font-medium text-foreground" : "text-foreground"
          )}
        >
          {row.name}
          {row.is_me && <span className="ml-1 text-[10px] text-muted-foreground">({youLabel})</span>}
        </Link>
      </div>
      <div className="px-3 py-2.5 flex items-center text-xs tabular-nums text-muted-foreground">
        {row.games}
      </div>
      <div className="px-3 py-2.5 flex items-center text-xs tabular-nums font-medium">
        {row.avg_score}%
      </div>
      <div className="px-3 py-2.5 flex items-center text-xs tabular-nums text-muted-foreground">
        {row.best_score}%
      </div>
    </div>
  );
}

export default function LeaderboardClient() {
  const { t } = useI18n();
  const [period, setPeriod] = useState("all");
  const [top, setTop] = useState([]);
  const [myRow, setMyRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/leaderboard?period=${period}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        const me = data.find((r) => r.is_me && r.rank > 50) ?? null;
        setTop(data.filter((r) => r.rank <= 50));
        setMyRow(me);
      })
      .catch(() => { setTop([]); setMyRow(null); })
      .finally(() => setLoading(false));
  }, [period]);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8 flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <h1 className="text-xl font-semibold tracking-tight">{t("lb.title")}</h1>
          {stats && (
            <div className="grid grid-cols-3 border border-border">
              {[
                { labelKey: "lb.stat.games", value: stats.total_games },
                { labelKey: "lb.stat.players", value: stats.total_players },
                { labelKey: "lb.stat.songs", value: stats.total_songs },
              ].map((s) => (
                <div key={s.labelKey} className="px-4 py-3 border-r border-border last:border-r-0 flex flex-col gap-0.5">
                  <span className="text-lg font-semibold tabular-nums">{s.value}</span>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{t(s.labelKey)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex border border-border overflow-hidden self-start">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={cn(
                "px-4 py-1.5 text-xs transition-colors border-r border-border last:border-r-0",
                period === p.id ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-accent"
              )}
            >
              {t(p.key)}
            </button>
          ))}
        </div>

        {loading && <p className="text-xs text-muted-foreground py-10 text-center">{t("lb.loading")}</p>}

        {!loading && top.length === 0 && (
          <p className="text-sm text-muted-foreground py-10 text-center">{t("lb.empty")}</p>
        )}

        {!loading && top.length > 0 && (
          <div className="border border-border">
            <div className="grid grid-cols-[2rem_1fr_4rem_4rem_5.5rem] border-b border-border">
              {["#", t("lb.col.player"), t("lb.col.games"), t("lb.col.avg"), t("lb.col.best")].map((h, i) => (
                <div key={i} className="px-3 py-1.5 text-[10px] text-muted-foreground uppercase tracking-widest">
                  {h}
                </div>
              ))}
            </div>
            {top.map((row) => <Row key={row.rank} row={row} youLabel={t("lb.you")} />)}

            {myRow && (
              <>
                <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-dashed border-border text-center">
                  ···
                </div>
                <Row row={myRow} youLabel={t("lb.you")} />
              </>
            )}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
