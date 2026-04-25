"use client";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import SearchBar from "@/components/SearchBar";
import GenrePicker from "@/components/GenrePicker";
import DifficultySelector from "@/components/DifficultySelector";
import { useI18n } from "@/contexts/I18nContext";
import { useAudio } from "@/contexts/AudioContext";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Flame } from "lucide-react";
import Footer from "@/components/Footer";
import PreviewButton from "@/components/PreviewButton";

function cleanArtist(name) {
  return name.split(/\s+(?:feat\.?|ft\.?|with)\s+/i)[0].trim();
}

function SongRow({ song, selected, onSelect }) {
  const lfm  = `https://www.last.fm/music/${encodeURIComponent(song.artist)}/_/${encodeURIComponent(song.title)}`;
  const spfy = `https://open.spotify.com/search/${encodeURIComponent(song.artist + " " + song.title)}`;
  return (
    <div
      onClick={() => onSelect(song)}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 cursor-pointer border-b border-border last:border-0 transition-colors",
        selected ? "bg-accent" : "hover:bg-accent"
      )}
    >
      {song.cover
        ? <img src={song.cover} alt={song.title} width={32} height={32} className="w-8 h-8 object-cover shrink-0 border border-border" />
        : <div className="w-8 h-8 border border-border shrink-0 bg-secondary" />
      }
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{song.title}</p>
        <p className="text-xs text-muted-foreground truncate">
          <Link
            href={`/artist/${encodeURIComponent(cleanArtist(song.artist))}`}
            className="hover:underline"
            onClick={(e) => e.stopPropagation()}
          >{song.artist}</Link>
          {song.album ? ` · ${song.album}` : ""}
        </p>
      </div>
      <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
        <PreviewButton url={song.preview} />
        <a href={lfm}  target="_blank" rel="noopener noreferrer" className="text-[10px] px-1.5 py-0.5 border border-border text-muted-foreground hover:border-foreground hover:text-foreground transition-colors">lfm</a>
        <a href={spfy} target="_blank" rel="noopener noreferrer" className="text-[10px] px-1.5 py-0.5 border border-border text-muted-foreground hover:border-foreground hover:text-foreground transition-colors">spfy</a>
      </div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{label}</span>
      {children}
    </div>
  );
}

function useCountdown(seconds) {
  const [remaining, setRemaining] = useState(seconds);
  useEffect(() => {
    setRemaining(seconds);
    const id = setInterval(() => setRemaining((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [seconds]);
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function rankOrdinal(n, locale) {
  if (locale === "fr") return n === 1 ? "1er" : `${n}ème`;
  if (locale === "en") {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  return String(n); // raw number — ordinal context is in the i18n template
}

function fmtTimer(s) {
  if (!s) return null;
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function DailyCard({ difficulty }) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rerolling, setRerolling] = useState(false);
  const [yesterday, setYesterday] = useState(null);
  const [dailyProgress, setDailyProgress] = useState(null);
  const countdown = useCountdown(data?.seconds_until_reset ?? 0);

  useEffect(() => {
    fetch("/api/daily", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        // Check localStorage for in-progress daily game (only if active)
        if (d?.artist && d?.title && !d?.completed && !d?.abandoned) {
          try {
            const key = `lyricusProgress_${encodeURIComponent(d.artist)}_${encodeURIComponent(d.title)}_medium_flow`;
            const raw = localStorage.getItem(key);
            if (raw) {
              const saved = JSON.parse(raw);
              if (Date.now() - saved.savedAt <= 7 * 24 * 3600 * 1000) setDailyProgress(saved);
            }
          } catch {}
        }
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
    fetch("/api/daily/yesterday", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (d.available) setYesterday(d); })
      .catch(() => {});
  }, [user]);

  async function handleReroll() {
    if (rerolling || !data || data.rerolls_remaining <= 0 || data.completed || data.abandoned || dailyProgress) return;
    setRerolling(true);
    try {
      const r = await fetch("/api/daily/reroll", { method: "POST", credentials: "include" });
      if (r.ok) {
        try {
          const oldKey = `lyricusProgress_${encodeURIComponent(data.artist)}_${encodeURIComponent(data.title)}_medium_flow`;
          localStorage.removeItem(oldKey);
        } catch {}
        setDailyProgress(null);
        setData(await r.json());
      }
    } catch {}
    setRerolling(false);
  }

  function handlePlay() {
    if (!data?.artist) return;
    const p = new URLSearchParams({ artist: data.artist, title: data.title, difficulty: "medium", mode: "flow", is_daily: "1" });
    if (data.album) p.set("album", data.album);
    if (data.cover) p.set("cover", data.cover);
    if (data.seed != null) p.set("seed", String(data.seed));
    if (dailyProgress) p.set("resume", "1");
    router.push(`/game?${p}`);
  }

  function handleShowCorrection(song) {
    const p = new URLSearchParams({ artist: song.artist, title: song.title, reveal_all: "1" });
    if (song.album) p.set("album", song.album);
    if (song.cover) p.set("cover", song.cover);
    if (song.seed != null) p.set("seed", String(song.seed));
    // If we have stored found IDs from an abandon session for this song, pass them
    try {
      const today = new Date().toISOString().split("T")[0];
      const raw = localStorage.getItem(`lyricusDailyFoundIds_${today}`);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.artist === song.artist && saved.title === song.title) {
          // Always pass found_ids (empty string = 0 words found → all shown red)
          p.set("found_ids", (saved.found_ids ?? []).join(","));
        }
      }
    } catch {}
    router.push(`/game?${p}`);
  }

  const isActive = data && !data.locked && !data.completed && !data.abandoned;
  const canReroll = isActive && data.rerolls_remaining > 0 && !dailyProgress;

  return (
    <div className="flex flex-col gap-2">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
            {t("daily.title")}
            {!loading && data && !data.locked && (
              <span className="normal-case tabular-nums"> · {countdown}</span>
            )}
          </span>
          {data?.streak > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-orange-400 tabular-nums">
              <Flame size={10} className="shrink-0" />
              {data.streak}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {!loading && yesterday && (
            <button
              onClick={() => handleShowCorrection(yesterday)}
              className="text-[10px] text-muted-foreground border border-border px-2 py-0.5 hover:border-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              ↩ {t("daily.yesterday")}
            </button>
          )}
          {!loading && canReroll && (
            <button
              onClick={handleReroll}
              disabled={rerolling}
              className="text-[10px] text-muted-foreground border border-border px-2 py-0.5 hover:border-foreground hover:text-foreground transition-colors disabled:opacity-40 flex items-center gap-1"
            >
              ↻ {data.rerolls_remaining} {t("daily.reroll")}
            </button>
          )}
          {!loading && isActive && data.rerolls_remaining > 0 && dailyProgress && (
            <span className="text-[10px] border border-border px-2 py-0.5 opacity-30 cursor-not-allowed select-none flex items-center gap-1">
              ↻ {data.rerolls_remaining} {t("daily.reroll")}
            </span>
          )}
        </div>
      </div>

      {/* Card */}
      <div className="border border-border flex flex-col overflow-hidden">
        {loading && (
          <div className="px-3 py-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-secondary animate-pulse shrink-0" />
            <div className="flex flex-col gap-1.5 flex-1">
              <div className="h-3 bg-secondary animate-pulse w-3/4" />
              <div className="h-2.5 bg-secondary animate-pulse w-1/2" />
            </div>
          </div>
        )}

        {!loading && data?.locked && (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            {data.reason === "auth" ? t("daily.locked.auth") : t("daily.locked.no_games")}
          </p>
        )}

        {!loading && !data?.locked && data?.artist && (
          <div className="flex items-center gap-3 px-3 py-3">
            {/* Cover - always visible */}
            {data.cover
              ? <img src={data.cover} alt={data.title} width={40} height={40} className="w-10 h-10 object-cover border border-border shrink-0" />
              : <div className="w-10 h-10 border border-border shrink-0 bg-secondary" />
            }

            {/* Title + artist */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{data.title}</p>
              <p className="text-xs text-muted-foreground truncate">
                <Link
                  href={`/artist/${encodeURIComponent(cleanArtist(data.artist))}`}
                  className="hover:underline"
                >{data.artist}</Link>
              </p>
            </div>

            {/* Right side — play / completed / abandoned */}
            {isActive && (
              <button
                onClick={handlePlay}
                className="shrink-0 flex flex-col items-end gap-0.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <span className="text-xs">
                  {dailyProgress ? t("history.resume") + " →" : t("daily.play")}
                </span>
                {dailyProgress && (() => {
                  const rev = dailyProgress.revealed_ids?.length ?? dailyProgress.revealed?.length ?? 0;
                  const tot = dailyProgress.total ?? 0;
                  const timer = fmtTimer(dailyProgress.timer);
                  return (
                    <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                      {tot > 0 ? `${rev}/${tot}` : null}{timer ? ` · ${timer}` : null}
                    </span>
                  );
                })()}
              </button>
            )}

            {data.completed && (
              <div className="shrink-0 flex flex-col items-end gap-0.5 text-right">
                <span className="text-[11px] font-medium">✓ {t("daily.completed")}</span>
                {data.completion_rank && (() => {
                  const template = t("daily.completion_rank");
                  const parts = template.split("{{n}}");
                  const ordinal = rankOrdinal(data.completion_rank, locale);
                  return (
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {parts[0]}<strong className="text-foreground font-semibold">{ordinal}</strong>{parts[1] ?? ""}
                    </span>
                  );
                })()}
              </div>
            )}

            {data.abandoned && (
              <div className="shrink-0 flex flex-col items-end gap-0.5 text-right">
                <span className="text-[11px] font-medium text-muted-foreground">✕ {t("daily.abandoned")}</span>
                <button
                  className="mt-0.5 text-[10px] border border-border px-2 py-0.5 text-muted-foreground hover:border-foreground hover:text-foreground transition-colors whitespace-nowrap"
                  onClick={() => handleShowCorrection(data)}
                >
                  {t("daily.abandoned.correction")}
                </button>
              </div>
            )}
          </div>
        )}

        {!loading && !data?.locked && !data?.artist && (
          <p className="px-3 py-4 text-xs text-muted-foreground">{t("daily.unavailable")}</p>
        )}
      </div>
    </div>
  );
}

const PLAYLIST_CACHE_KEY = "lyricusPlaylistCache";

function getPlaylistCache() {
  try {
    const raw = sessionStorage.getItem(PLAYLIST_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function setPlaylistCache(playlistIds, tracks) {
  try {
    sessionStorage.setItem(PLAYLIST_CACHE_KEY, JSON.stringify({ playlistIds, tracks }));
  } catch {}
}

function playlistFingerprint(playlists) {
  return playlists.map((p) => p.id).sort().join(",");
}

export default function HomeClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const { stop } = useAudio();
  const { user } = useAuth();
  const [difficulty, setDifficulty] = useState("medium");
  const [selectedSong, setSelectedSong] = useState(null);

  // Pre-select song from URL params (e.g. from artist page or history)
  useEffect(() => {
    const artist = searchParams.get("artist");
    const title = searchParams.get("title");
    if (artist && title) {
      setSelectedSong({
        artist,
        title,
        album:   searchParams.get("album")   || "",
        cover:   searchParams.get("cover")   || "",
        preview: searchParams.get("preview") || "",
      });
    }
  }, []);

  const [suggestedSongs, setSuggestedSongs] = useState([]);
  const [loadingRandom, setLoadingRandom] = useState(false);
  const [error, setError] = useState(null);

  // Playlist random state
  const [userPlaylists, setUserPlaylists] = useState(null); // null = not yet fetched
  const [loadingPlaylist, setLoadingPlaylist] = useState(false);
  const [playlistError, setPlaylistError] = useState(null);

  // Fetch playlist metadata once when user is known (just IDs + count, lightweight)
  useEffect(() => {
    if (!user) return;
    fetch("/api/playlists", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setUserPlaylists(Array.isArray(data) ? data : []))
      .catch(() => setUserPlaylists([]));
  }, [user]);

  async function handlePlaylistPick() {
    if (!userPlaylists?.length || loadingPlaylist) return;
    setPlaylistError(null);

    const fingerprint = playlistFingerprint(userPlaylists);
    const cached = getPlaylistCache();

    // Use cache if fingerprint matches and we have tracks
    if (cached && cached.playlistIds === fingerprint && cached.tracks?.length) {
      const idx = Math.floor(Math.random() * cached.tracks.length);
      const song = cached.tracks[idx];
      setSelectedSong(song);
      setSuggestedSongs([]);
      setError(null);
      return;
    }

    // Fetch from API and cache
    setLoadingPlaylist(true);
    try {
      const res = await fetch("/api/playlists/tracks", { credentials: "include" });
      if (!res.ok) throw new Error();
      const tracks = await res.json();
      if (!tracks.length) throw new Error(t("home.playlist.error"));
      setPlaylistCache(fingerprint, tracks);
      const song = tracks[Math.floor(Math.random() * tracks.length)];
      setSelectedSong(song);
      setSuggestedSongs([]);
      setError(null);
    } catch {
      setPlaylistError(t("home.playlist.error"));
    } finally {
      setLoadingPlaylist(false);
    }
  }

  async function handleGenreSelect(genre) {
    setLoadingRandom(true);
    setError(null);
    setSuggestedSongs([]);
    setSelectedSong(null);
    try {
      const res = await fetch(`/api/random?genre_id=${genre.id}&count=5`);
      if (!res.ok) throw new Error(t("error.song.notfound"));
      setSuggestedSongs(await res.json());
    } catch (e) { setError(e.message); }
    finally { setLoadingRandom(false); }
  }

  function handleStart() {
    if (!selectedSong) return;
    stop();
    const p = new URLSearchParams({ artist: selectedSong.artist, title: selectedSong.title, difficulty, mode: "flow" });
    if (selectedSong.album) p.set("album", selectedSong.album);
    if (selectedSong.cover) p.set("cover", selectedSong.cover);
    router.push(`/game?${p.toString()}`);
  }

  const hasPlaylists = userPlaylists !== null && userPlaylists.length > 0;
  const playlistsLoaded = userPlaylists !== null;

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />

      <main className="flex-1 w-full max-w-lg mx-auto px-4 py-10 flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">lyricus</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("home.tagline")}</p>
        </div>

        <DailyCard difficulty={difficulty} />

        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <div className="flex-1 border-t border-border" />{t("home.or")}<div className="flex-1 border-t border-border" />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest shrink-0">
              {t("home.search.label")}
            </span>
            {user && playlistsLoaded && (
              <div className="relative group shrink-0">
                <button
                  onClick={hasPlaylists ? handlePlaylistPick : undefined}
                  disabled={loadingPlaylist || !hasPlaylists}
                  className={cn(
                    "text-[10px] border px-2 py-0.5 transition-colors flex items-center gap-1",
                    hasPlaylists && !loadingPlaylist
                      ? "text-muted-foreground border-border hover:border-foreground hover:text-foreground"
                      : "text-muted-foreground/30 border-border/30 cursor-default"
                  )}
                >
                  {loadingPlaylist ? t("home.playlist.loading") : t("home.playlist.btn")}
                </button>
                {!hasPlaylists && (
                  <div className="absolute right-0 top-full mt-1 z-20 bg-background border border-border px-2 py-1.5 text-[10px] text-muted-foreground whitespace-nowrap hidden group-hover:block pointer-events-none">
                    {t("home.playlist.noplaylists")}
                  </div>
                )}
              </div>
            )}
          </div>
          <SearchBar
            placeholder={t("home.search.placeholder")}
            onSelect={(s) => { setSelectedSong(s); setSuggestedSongs([]); setError(null); }}
          />
          {playlistError && <p className="text-[11px] text-muted-foreground">{playlistError}</p>}
        </div>

        <Section label={t("home.random.label")}>
          <GenrePicker onSelect={handleGenreSelect} loading={loadingRandom} />
          {loadingRandom && <p className="text-xs text-muted-foreground">{t("home.random.loading")}</p>}
        </Section>

        {error && <p className="text-xs text-muted-foreground border border-border px-3 py-2">{error}</p>}

        {suggestedSongs.length > 0 && (
          <Section label={t("home.pick.label")}>
            <div className="border border-border">
              {suggestedSongs.map((song, i) => (
                <SongRow key={i} song={song}
                  selected={selectedSong?.title === song.title && selectedSong?.artist === song.artist}
                  onSelect={setSelectedSong}
                />
              ))}
            </div>
          </Section>
        )}

        {selectedSong && suggestedSongs.length === 0 && (
          <Section label={t("home.selected.label")}>
            <div className="border border-border">
              <SongRow song={selectedSong} selected onSelect={() => {}} />
            </div>
          </Section>
        )}

        <DifficultySelector difficulty={difficulty} onDifficulty={setDifficulty} />

        <button
          onClick={handleStart}
          disabled={!selectedSong}
          className="w-full h-10 border border-foreground bg-foreground text-background text-sm font-medium hover:bg-foreground/85 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {t("home.play")}
        </button>
      </main>

      <Footer />
    </div>
  );
}
