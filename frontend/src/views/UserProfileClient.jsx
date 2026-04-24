"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import { Flame, Star } from "lucide-react";
import { ICON_MAP } from "@/components/BadgeGrid";

function cleanArtist(artist) {
  return artist.split(/\s+(?:feat\.?|ft\.?|with)\s+/i)[0].trim();
}

function StatBox({ label, value }) {
  return (
    <div className="border border-border px-4 py-3 flex flex-col gap-0.5">
      <span className="text-xl font-semibold tabular-nums">{value ?? "—"}</span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{label}</span>
    </div>
  );
}

const DIFF_COLOR = {
  easy: "text-green-500",
  medium: "text-yellow-500",
  hard: "text-orange-500",
  extreme: "text-red-500",
};

export default function UserProfileClient() {
  const { username } = useParams();
  const router = useRouter();
  const { user: authUser, logout } = useAuth();
  const { t } = useI18n();
  const DIFF_LABELS = { easy: t("diff.easy"), medium: t("diff.medium"), hard: t("diff.hard"), extreme: t("diff.extreme") };
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [badges, setBadges] = useState([]);
  const [badgesModal, setBadgesModal] = useState(false);

  useEffect(() => {
    if (!username) return;
    fetch(`/api/users/${encodeURIComponent(username)}`)
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.json();
      })
      .then((d) => { if (d) setProfile(d); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
    fetch(`/api/badges?username=${encodeURIComponent(username)}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setBadges(d.badges ?? []))
      .catch(() => {});
  }, [username]);

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8 flex flex-col gap-8">
        {loading && (
          <p className="text-xs text-muted-foreground py-20 text-center">{t("profile.loading")}</p>
        )}

        {notFound && (
          <div className="flex flex-col gap-4 py-20 items-center">
            <p className="text-sm text-muted-foreground">{t("profile.notfound")}</p>
            <Link href="/leaderboard" className="text-xs border border-border px-3 py-1.5 hover:border-foreground transition-colors">
              {t("nav.leaderboard")}
            </Link>
          </div>
        )}

        {profile && (
          <>
            {/* Header */}
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 border border-border flex items-center justify-center text-lg font-semibold bg-secondary">
                {(profile.name || "?")[0].toUpperCase()}
              </div>
              <div className="flex-1 flex flex-col gap-0.5">
                <h1 className="text-xl font-semibold tracking-tight">{profile.name}</h1>
                {profile.rank && (
                  <span className="text-xs text-muted-foreground">
                    #{profile.rank} {t("profile.rank")}
                  </span>
                )}
              </div>
              {profile.is_me && (
                <div className="flex items-center gap-2 shrink-0">
                  {authUser?.email && (
                    <span className="text-xs text-muted-foreground hidden sm:block truncate max-w-[180px]">
                      {authUser.email}
                    </span>
                  )}
                  <button
                    onClick={() => logout()}
                    className="text-xs border border-border px-3 py-1.5 text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
                  >
                    {t("profile.disconnect")}
                  </button>
                </div>
              )}
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border">
              <StatBox label={t("profile.games")} value={profile.games} />
              <StatBox label={t("profile.avg")} value={profile.avg_score != null ? `${profile.avg_score}%` : null} />
              <StatBox label={t("profile.best")} value={profile.best_score != null ? `${profile.best_score}%` : null} />
              <StatBox label={t("profile.songs")} value={profile.unique_songs} />
            </div>

            {/* Streak */}
            {(profile.current_streak > 0 || profile.longest_streak > 0) && (
              <div className="flex gap-px bg-border">
                <div className="flex-1 bg-background border border-border px-4 py-3 flex items-center gap-2">
                  <Flame size={14} className="text-orange-400 shrink-0" />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xl font-semibold tabular-nums">{profile.current_streak ?? 0}</span>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{t("profile.streak")}</span>
                  </div>
                </div>
                <div className="flex-1 bg-background border border-border px-4 py-3 flex flex-col gap-0.5">
                  <span className="text-xl font-semibold tabular-nums">{profile.longest_streak ?? 0}</span>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{t("profile.streak.best")}</span>
                </div>
              </div>
            )}

            {/* Badges */}
            {badges.length > 0 && (() => {
              const sorted = [...badges].sort((a, b) => (b.earned ? 1 : 0) - (a.earned ? 1 : 0));
              const earnedCount = badges.filter(b => b.earned).length;
              // Show 11 badges (earned first, fill with unearned) + 1 "show all" button
              const PREVIEW = 11;
              const preview = sorted.slice(0, PREVIEW);
              const hasMore = sorted.length > PREVIEW;
              return (
                <>
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-xs text-muted-foreground uppercase tracking-widest">{t("profile.badges")}</h2>
                      <span className="text-xs text-muted-foreground tabular-nums">{earnedCount}/{badges.length}</span>
                    </div>
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                      {preview.map((badge) => {
                        const Icon = ICON_MAP[badge.icon] ?? Star;
                        return (
                          <div
                            key={badge.id}
                            title={`${t(`badge.${badge.id}.label`) || badge.label} — ${t(`badge.${badge.id}.desc`) || badge.desc}${badge.earned_at ? `\n${new Date(badge.earned_at).toLocaleDateString()}` : ""}`}
                            className={cn(
                              "flex flex-col items-center gap-1.5 p-2 border transition-colors",
                              badge.earned ? "border-border text-foreground" : "border-border/40 text-muted-foreground/30"
                            )}
                          >
                            <Icon size={20} strokeWidth={1.5} />
                            <span className="text-[9px] text-center leading-tight truncate w-full">{t(`badge.${badge.id}.label`) || badge.label}</span>
                          </div>
                        );
                      })}
                      {hasMore && (
                        <button
                          onClick={() => setBadgesModal(true)}
                          className="flex flex-col items-center justify-center gap-1 p-2 border border-border text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
                        >
                          <span className="text-sm leading-none font-medium">···</span>
                          <span className="text-[9px]">+{sorted.length - PREVIEW}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Modal */}
                  {badgesModal && (
                    <div
                      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
                      onClick={() => setBadgesModal(false)}
                    >
                      <div
                        className="bg-background border border-border w-full max-w-lg max-h-[80vh] flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                          <span className="text-xs uppercase tracking-widest font-medium">{t("profile.badges")} · {earnedCount}/{badges.length}</span>
                          <button onClick={() => setBadgesModal(false)} className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1">✕</button>
                        </div>
                        <div className="overflow-y-auto p-4 grid grid-cols-3 sm:grid-cols-4 gap-3">
                          {sorted.map((badge) => {
                            const Icon = ICON_MAP[badge.icon] ?? Star;
                            const hasProgress = !badge.earned && badge.progress_total != null;
                            return (
                              <div
                                key={badge.id}
                                className={cn(
                                  "flex flex-col items-center gap-2 p-3 border text-center",
                                  badge.earned ? "border-border text-foreground" : "border-border/40 text-muted-foreground/30"
                                )}
                              >
                                <Icon size={22} strokeWidth={1.5} />
                                <div className="flex flex-col gap-0.5 w-full">
                                  <span className="text-[10px] font-medium leading-tight">{t(`badge.${badge.id}.label`) || badge.label}</span>
                                  <span className={cn("text-[9px] leading-tight", badge.earned ? "text-muted-foreground" : "text-muted-foreground/30")}>
                                    {t(`badge.${badge.id}.desc`) || badge.desc}
                                  </span>
                                  {hasProgress && (
                                    <span className="text-[9px] tabular-nums text-muted-foreground/50 mt-0.5">
                                      {badge.progress_current}/{badge.progress_total}
                                    </span>
                                  )}
                                  {badge.earned_at && (
                                    <span className="text-[9px] text-muted-foreground/50 tabular-nums mt-0.5">
                                      {new Date(badge.earned_at).toLocaleDateString()}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Stats by difficulty */}
            {profile.by_difficulty?.length > 0 && (
              <div className="flex flex-col gap-3">
                <h2 className="text-xs text-muted-foreground uppercase tracking-widest">{t("profile.by_diff")}</h2>
                <div className="flex flex-col gap-2">
                  {profile.by_difficulty.map((d) => (
                    <div key={d.difficulty} className="flex items-center gap-3">
                      <span className={cn("text-xs w-16 shrink-0", DIFF_COLOR[d.difficulty] ?? "text-muted-foreground")}>
                        {DIFF_LABELS[d.difficulty] ?? d.difficulty}
                      </span>
                      <div className="flex-1 h-1.5 bg-secondary overflow-hidden">
                        <div
                          className="h-full bg-foreground transition-all"
                          style={{ width: `${d.avg_score}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground w-14 text-right shrink-0">
                        {d.avg_score}% · {d.games}p
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Favorite artists */}
            {profile.top_artists?.length > 0 && (
              <div className="flex flex-col gap-3">
                <h2 className="text-xs text-muted-foreground uppercase tracking-widest">{t("profile.top_artists")}</h2>
                <div className="flex flex-wrap gap-3">
                  {profile.top_artists.map((a) => (
                    <Link
                      key={a.name}
                      href={`/artist/${encodeURIComponent(a.name)}`}
                      className="flex flex-col items-center gap-1.5 group w-16"
                    >
                      {a.picture
                        ? <img src={a.picture} alt={a.name} width={56} height={56} className="w-14 h-14 object-cover border border-border group-hover:border-foreground transition-colors" />
                        : <div className="w-14 h-14 border border-border bg-secondary flex items-center justify-center text-lg font-semibold group-hover:border-foreground transition-colors">
                            {a.name[0].toUpperCase()}
                          </div>
                      }
                      <span className="text-[10px] text-muted-foreground text-center truncate w-full leading-tight">{a.name}</span>
                      <span className="text-[9px] text-muted-foreground/60 tabular-nums">{a.plays}p</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Recent games */}
            {profile.recent?.length > 0 && (
              <div className="flex flex-col gap-3">
                <h2 className="text-xs text-muted-foreground uppercase tracking-widest">{t("profile.recent")}</h2>
                <div className="border border-border">
                  {profile.recent.map((g, i) => {
                    const pct = g.score_total > 0 ? Math.round(g.score_correct * 100 / g.score_total) : 0;
                    const date = new Date(g.played_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
                    return (
                      <div
                        key={i}
                        onClick={() => {
                          const p = new URLSearchParams({ artist: g.artist, title: g.title });
                          if (g.album) p.set("album", g.album);
                          if (g.cover) p.set("cover", g.cover);
                          router.push(`/?${p}`);
                        }}
                        className="grid grid-cols-[auto_1fr_6rem_4rem_5rem] items-center border-b border-border last:border-0 hover:bg-accent transition-colors cursor-pointer"
                      >
                        <div className="p-2 shrink-0">
                          {g.cover
                            ? <img src={g.cover} alt={g.title} width={32} height={32} className="w-8 h-8 object-cover border border-border" />
                            : <div className="w-8 h-8 border border-border bg-secondary" />
                          }
                        </div>
                        <div className="px-2 py-2.5 min-w-0">
                          <p className="text-xs font-medium truncate">{g.title}</p>
                          <Link
                            href={`/artist/${encodeURIComponent(cleanArtist(g.artist))}`}
                            className="text-[10px] text-muted-foreground truncate hover:underline block"
                            onClick={(e) => e.stopPropagation()}
                          >{g.artist}</Link>
                        </div>
                        <div className={cn("px-2 py-2.5 text-xs tabular-nums", DIFF_COLOR[g.difficulty] ?? "text-muted-foreground")}>
                          {DIFF_LABELS[g.difficulty] ?? g.difficulty}
                          {g.is_daily && <span className="ml-1 text-[9px] text-muted-foreground/60 uppercase">·{t("history.daily")}</span>}
                        </div>
                        <div className="px-2 py-2.5 text-xs tabular-nums font-medium">{pct}%</div>
                        <div className="px-2 py-2.5 text-xs tabular-nums text-muted-foreground">{date}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* History private notice */}
            {!profile.public_history && !profile.is_me && (
              <p className="text-xs text-muted-foreground text-center py-4">{t("profile.private")}</p>
            )}
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}
