"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";

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
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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
                    onClick={async () => { await logout(); router.push("/"); }}
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

            {/* Stats by difficulty */}
            {profile.by_difficulty?.length > 0 && (
              <div className="flex flex-col gap-3">
                <h2 className="text-xs text-muted-foreground uppercase tracking-widest">{t("profile.by_diff")}</h2>
                <div className="flex flex-col gap-2">
                  {profile.by_difficulty.map((d) => (
                    <div key={d.difficulty} className="flex items-center gap-3">
                      <span className={cn("text-xs w-16 shrink-0", DIFF_COLOR[d.difficulty] ?? "text-muted-foreground")}>
                        {d.difficulty}
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

            {/* Stats by mode */}
            {profile.by_mode?.length > 0 && (
              <div className="flex flex-col gap-3">
                <h2 className="text-xs text-muted-foreground uppercase tracking-widest">{t("profile.by_mode")}</h2>
                <div className="flex flex-col gap-2">
                  {profile.by_mode.map((m) => (
                    <div key={m.mode} className="flex items-center gap-3">
                      <span className="text-xs w-16 shrink-0 text-muted-foreground">{m.mode}</span>
                      <div className="flex-1 h-1.5 bg-secondary overflow-hidden">
                        <div
                          className="h-full bg-foreground transition-all"
                          style={{ width: `${m.avg_score}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground w-14 text-right shrink-0">
                        {m.avg_score}% · {m.games}p
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
                        className="flex items-center gap-3 border-b border-border last:border-0 px-3 py-2.5 hover:bg-accent transition-colors cursor-pointer"
                      >
                        {g.cover
                          ? <img src={g.cover} alt={g.title} width={28} height={28} className="w-7 h-7 object-cover border border-border shrink-0" />
                          : <div className="w-7 h-7 border border-border bg-secondary shrink-0" />
                        }
                        <div className="flex-1 flex flex-col gap-0.5 min-w-0">
                          <span className="text-xs font-medium truncate">{g.title}</span>
                          <Link
                            href={`/artist/${encodeURIComponent(cleanArtist(g.artist))}`}
                            className="text-[11px] text-muted-foreground truncate hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >{g.artist}</Link>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 text-xs">
                          <span className={cn("tabular-nums", DIFF_COLOR[g.difficulty] ?? "text-muted-foreground")}>
                            {g.difficulty}
                          </span>
                          <span className="tabular-nums font-medium">{pct}%</span>
                          <span className="text-muted-foreground tabular-nums">{date}</span>
                        </div>
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
