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
import { LOCALE_META } from "@/lib/i18n";
import { cn } from "@/lib/utils";
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

function DailyCard({ chartKey, label, t, difficulty, mode }) {
  const router = useRouter();
  const [song, setSong] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/daily?chart=${chartKey}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => setSong(d))
      .catch(() => setSong(null))
      .finally(() => setLoading(false));
  }, [chartKey]);

  function handlePlay() {
    if (!song) return;
    const p = new URLSearchParams({ artist: song.artist, title: song.title, difficulty, mode });
    if (song.album) p.set("album", song.album);
    if (song.cover) p.set("cover", song.cover);
    router.push(`/game?${p}`);
  }

  return (
    <div className="border border-border flex flex-col overflow-hidden">
      <div className="px-3 py-1.5 border-b border-border flex items-center justify-between bg-secondary/40">
        <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{label}</span>
        {song && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {t("daily.rank")} {song.chart_rank}
          </span>
        )}
      </div>

      {loading && (
        <div className="px-3 py-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-secondary animate-pulse shrink-0" />
          <div className="flex flex-col gap-1.5 flex-1">
            <div className="h-3 bg-secondary animate-pulse w-3/4" />
            <div className="h-2.5 bg-secondary animate-pulse w-1/2" />
          </div>
        </div>
      )}

      {!loading && !song && (
        <p className="px-3 py-4 text-xs text-muted-foreground">{t("daily.unavailable")}</p>
      )}

      {!loading && song && (
        <button
          onClick={handlePlay}
          className="flex items-center gap-3 px-3 py-3 hover:bg-accent transition-colors text-left w-full"
        >
          {song.cover
            ? <img src={song.cover} alt={song.title} width={40} height={40} className="w-10 h-10 object-cover border border-border shrink-0" />
            : <div className="w-10 h-10 border border-border shrink-0 bg-secondary" />
          }
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{song.title}</p>
            <Link
              href={`/artist/${encodeURIComponent(cleanArtist(song.artist))}`}
              className="text-xs text-muted-foreground truncate block hover:underline"
              onClick={(e) => e.stopPropagation()}
            >{song.artist}</Link>
          </div>
          <span className="text-xs text-muted-foreground shrink-0">{t("daily.play")}</span>
        </button>
      )}
    </div>
  );
}

export default function HomeClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, locale } = useI18n();
  const { stop } = useAudio();
  const [difficulty, setDifficulty] = useState("medium");
  const [mode, setMode] = useState("normal");
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
    const p = new URLSearchParams({ artist: selectedSong.artist, title: selectedSong.title, difficulty, mode });
    if (selectedSong.album) p.set("album", selectedSong.album);
    if (selectedSong.cover) p.set("cover", selectedSong.cover);
    router.push(`/game?${p.toString()}`);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />

      <main className="flex-1 w-full max-w-lg mx-auto px-4 py-10 flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">lyricus</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("home.tagline")}</p>
        </div>

        <Section label={t("daily.title")}>
          <div className="flex flex-col gap-2">
            <DailyCard chartKey="global" label={t("daily.mondial")} t={t} difficulty={difficulty} mode={mode} />
            <DailyCard chartKey={LOCALE_META[locale]?.chart ?? "fr"} label={t("daily.lang")} t={t} difficulty={difficulty} mode={mode} />
          </div>
        </Section>

        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <div className="flex-1 border-t border-border" />{t("home.or")}<div className="flex-1 border-t border-border" />
        </div>

        <Section label={t("home.search.label")}>
          <SearchBar
            placeholder={t("home.search.placeholder")}
            onSelect={(s) => { setSelectedSong(s); setSuggestedSongs([]); setError(null); }}
          />
        </Section>

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

        <DifficultySelector difficulty={difficulty} onDifficulty={setDifficulty} mode={mode} onMode={setMode} />

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
