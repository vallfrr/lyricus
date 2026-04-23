"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import PreviewButton from "@/components/PreviewButton";
import { useI18n } from "@/contexts/I18nContext";

function fmtFans(n) {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export default function ArtistClient() {
  const { name } = useParams();
  const router = useRouter();
  const { t } = useI18n();
  const [artist, setArtist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!name) return;
    fetch(`/api/artist?name=${encodeURIComponent(name)}`)
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.json();
      })
      .then((d) => { if (d) setArtist(d); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [name]);

  function handlePlay(track) {
    const p = new URLSearchParams({ artist: track.artist, title: track.title });
    if (track.album)   p.set("album", track.album);
    if (track.cover)   p.set("cover", track.cover);
    if (track.preview) p.set("preview", track.preview);
    router.push(`/?${p}`);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8 flex flex-col gap-8">
        {loading && (
          <div className="flex flex-col gap-6 py-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-secondary animate-pulse shrink-0" />
              <div className="flex flex-col gap-2 flex-1">
                <div className="h-5 bg-secondary animate-pulse w-1/3" />
                <div className="h-3 bg-secondary animate-pulse w-1/4" />
              </div>
            </div>
          </div>
        )}

        {notFound && (
          <div className="flex flex-col gap-4 py-20 items-center">
            <p className="text-sm text-muted-foreground">{t("artist.notfound")}</p>
            <Link href="/" className="text-xs border border-border px-3 py-1.5 hover:border-foreground transition-colors">
              {t("game.return")}
            </Link>
          </div>
        )}

        {artist && (
          <>
            {/* Artist header */}
            <div className="flex items-center gap-4">
              {artist.picture
                ? <img src={artist.picture} alt={artist.name} width={64} height={64} className="w-16 h-16 object-cover border border-border shrink-0" />
                : <div className="w-16 h-16 border border-border shrink-0 bg-secondary flex items-center justify-center text-2xl font-semibold">
                    {artist.name[0].toUpperCase()}
                  </div>
              }
              <div className="flex flex-col gap-0.5">
                <h1 className="text-2xl font-bold tracking-tight">{artist.name}</h1>
                {artist.fans > 0 && (
                  <span className="text-xs text-muted-foreground">{fmtFans(artist.fans)} {t("artist.fans")}</span>
                )}
              </div>
            </div>

            {/* Tracks */}
            {artist.tracks?.length > 0 ? (
              <div className="flex flex-col gap-3">
                <h2 className="text-[10px] text-muted-foreground uppercase tracking-widest">{t("artist.tracks")}</h2>
                <div className="border border-border">
                  {artist.tracks.map((track, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 px-3 py-2.5 border-b border-border last:border-0 hover:bg-accent transition-colors cursor-pointer"
                      onClick={() => handlePlay(track)}
                    >
                      {track.cover
                        ? <img src={track.cover} alt={track.title} width={36} height={36} className="w-9 h-9 object-cover border border-border shrink-0" />
                        : <div className="w-9 h-9 border border-border shrink-0 bg-secondary" />
                      }
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{track.title}</p>
                        {track.album && (
                          <p className="text-xs text-muted-foreground truncate">{track.album}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <PreviewButton url={track.preview} />
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0 border border-border px-1.5 py-0.5 pointer-events-none">
                        {t("artist.play")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-10 text-center">
                {t("artist.notracks")}
              </p>
            )}
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}
