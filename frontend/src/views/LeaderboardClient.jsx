"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import { useI18n } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";

const PERIODS = [
  { id: "all",  key: "lb.period.all" },
  { id: "week", key: "lb.period.week" },
];

const COLS = "grid-cols-[2rem_1fr_5.5rem_5rem_5rem_4rem]";

// ── Sub-components ─────────────────────────────────────────────────────────────

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
    <span className={cn("tabular-nums font-mono text-xs w-5 text-center shrink-0", colors[rank] ?? "text-muted-foreground")}>
      {rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : rank}
    </span>
  );
}

function Row({ row, youLabel, rowRef }) {
  return (
    <div
      ref={rowRef}
      className={cn(
        `grid ${COLS} items-center border-b border-border last:border-0 transition-colors`,
        row.is_me
          ? "bg-foreground/5 border-l-2 border-l-foreground"
          : "hover:bg-accent"
      )}
    >
      <div className="pl-3 py-2.5 flex items-center">
        <RankBadge rank={row.rank} />
      </div>
      <div className="px-2 py-2.5 flex items-center gap-2 min-w-0">
        <Avatar name={row.name} />
        <Link
          href={`/u/${encodeURIComponent(row.name)}`}
          className={cn(
            "text-xs truncate hover:underline",
            row.is_me ? "font-semibold text-foreground" : "text-foreground"
          )}
        >
          {row.name}
          {row.is_me && (
            <span className="ml-1 text-[10px] text-muted-foreground font-normal">({youLabel})</span>
          )}
        </Link>
      </div>
      <div className="px-2 py-2.5 text-xs tabular-nums font-semibold text-foreground">
        {row.total_points.toLocaleString()}
      </div>
      <div className="px-2 py-2.5 text-xs tabular-nums text-muted-foreground">
        {row.songs}
      </div>
      <div className="px-2 py-2.5 text-xs tabular-nums text-muted-foreground">
        {row.avg_points}
      </div>
      <div className="px-2 py-2.5 text-xs tabular-nums">
        {row.streak > 0
          ? <span className="text-orange-400">{row.streak}🔥</span>
          : <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );
}

function Pagination({ page, totalPages, onChange }) {
  const [inputVal, setInputVal] = useState(String(page));

  useEffect(() => setInputVal(String(page)), [page]);

  function commit() {
    const n = parseInt(inputVal, 10);
    if (!isNaN(n)) onChange(Math.max(1, Math.min(totalPages, n)));
    else setInputVal(String(page));
  }

  const btnBase = "w-7 h-7 flex items-center justify-center border border-border text-xs transition-colors hover:bg-accent disabled:opacity-30 disabled:pointer-events-none";

  return (
    <div className="flex items-center justify-center gap-1.5 py-4">
      <button className={btnBase} onClick={() => onChange(1)} disabled={page === 1} title="Première page">
        «
      </button>
      <button className={btnBase} onClick={() => onChange(page - 1)} disabled={page === 1} title="Page précédente">
        ‹
      </button>

      <div className="flex items-center gap-1.5 mx-1">
        <input
          className="w-10 h-7 border border-border bg-background text-center text-xs tabular-nums focus:outline-none focus:border-foreground transition-colors"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
        <span className="text-xs text-muted-foreground whitespace-nowrap">/ {totalPages}</span>
      </div>

      <button className={btnBase} onClick={() => onChange(page + 1)} disabled={page === totalPages} title="Page suivante">
        ›
      </button>
      <button className={btnBase} onClick={() => onChange(totalPages)} disabled={page === totalPages} title="Dernière page">
        »
      </button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function LeaderboardClient() {
  const { t } = useI18n();
  const [period, setPeriod]     = useState("all");
  const [page, setPage]         = useState(1);
  const [data, setData]         = useState({ rows: [], page: 1, total_pages: 1, total: 0, my_rank: null, my_page: null });
  const [loading, setLoading]   = useState(true);
  const [stats, setStats]       = useState(null);

  const scrollToMeRef = useRef(false);
  const myRowRef      = useRef(null);

  // ── Fetch leaderboard page ──────────────────────────────────────────────────
  const fetchPage = useCallback(() => {
    setLoading(true);
    fetch(`/api/leaderboard?period=${period}&page=${page}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData({ rows: [], page: 1, total_pages: 1, total: 0, my_rank: null, my_page: null }))
      .finally(() => setLoading(false));
  }, [period, page]);

  useEffect(() => { fetchPage(); }, [fetchPage]);

  // ── Scroll to my row after page loads ──────────────────────────────────────
  useEffect(() => {
    if (!loading && scrollToMeRef.current) {
      scrollToMeRef.current = false;
      if (myRowRef.current) {
        myRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [loading]);

  // ── Stats box ──────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/stats").then((r) => r.json()).then(setStats).catch(() => {});
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────────
  function handlePeriodChange(p) {
    setPeriod(p);
    setPage(1);
  }

  function handlePageChange(p) {
    setPage(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goToMyRank() {
    if (!data.my_page) return;
    scrollToMeRef.current = true;
    if (data.my_page === page) {
      // Already on the right page — just scroll
      scrollToMeRef.current = false;
      if (myRowRef.current) myRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      setPage(data.my_page);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8 flex flex-col gap-6">

        {/* Title + global stats */}
        <div className="flex flex-col gap-4">
          <h1 className="text-xl font-semibold tracking-tight">{t("lb.title")}</h1>
          {stats && (
            <div className="grid grid-cols-3 border border-border">
              {[
                { labelKey: "lb.stat.games",   value: stats.total_games },
                { labelKey: "lb.stat.players",  value: stats.total_players },
                { labelKey: "lb.stat.songs",    value: stats.total_songs },
              ].map((s) => (
                <div key={s.labelKey} className="px-4 py-3 border-r border-border last:border-r-0 flex flex-col gap-0.5">
                  <span className="text-lg font-semibold tabular-nums">{s.value}</span>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{t(s.labelKey)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Controls row: period selector + "mon classement" */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex border border-border overflow-hidden">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                onClick={() => handlePeriodChange(p.id)}
                className={cn(
                  "px-4 py-1.5 text-xs transition-colors border-r border-border last:border-r-0",
                  period === p.id
                    ? "bg-foreground text-background"
                    : "bg-background text-foreground hover:bg-accent"
                )}
              >
                {t(p.key)}
              </button>
            ))}
          </div>

          {data.my_rank && (
            <button
              onClick={goToMyRank}
              className="text-xs border border-border px-3 py-1.5 text-muted-foreground hover:border-foreground hover:text-foreground transition-colors whitespace-nowrap flex items-center gap-1.5"
            >
              <span>⊙</span>
              <span>{t("lb.my_rank")}</span>
              <span className="tabular-nums text-[10px] opacity-60">#{data.my_rank}</span>
            </button>
          )}
        </div>

        {/* Loading / empty */}
        {loading && (
          <p className="text-xs text-muted-foreground py-10 text-center">{t("lb.loading")}</p>
        )}
        {!loading && data.rows.length === 0 && (
          <p className="text-sm text-muted-foreground py-10 text-center">{t("lb.empty")}</p>
        )}

        {/* Table */}
        {!loading && data.rows.length > 0 && (
          <div className="flex flex-col gap-0">
            <div className="border border-border">
              {/* Header */}
              <div className={`grid ${COLS} border-b border-border bg-secondary/20`}>
                {[
                  { label: t("lb.col.rank"),   cls: "pl-3" },
                  { label: t("lb.col.player"), cls: "px-2" },
                  { label: t("lb.col.points"), cls: "px-2 text-foreground/80" },
                  { label: t("lb.col.games"),  cls: "px-2" },
                  { label: t("lb.col.avg"),    cls: "px-2" },
                  { label: t("lb.col.best"),   cls: "px-2" },
                ].map(({ label, cls }, i) => (
                  <div key={i} className={cn("py-2 text-[9px] text-muted-foreground uppercase tracking-widest whitespace-nowrap", cls)}>
                    {label}
                  </div>
                ))}
              </div>

              {/* Rows */}
              {data.rows.map((row) => (
                <Row
                  key={row.rank}
                  row={row}
                  youLabel={t("lb.you")}
                  rowRef={row.is_me ? myRowRef : null}
                />
              ))}
            </div>

            {/* Pagination */}
            {data.total_pages > 1 && (
              <Pagination
                page={page}
                totalPages={data.total_pages}
                onChange={handlePageChange}
              />
            )}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
