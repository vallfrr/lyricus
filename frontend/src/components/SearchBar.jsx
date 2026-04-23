"use client";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import PreviewButton from "@/components/PreviewButton";
import { useAudio } from "@/contexts/AudioContext";

function cleanArtist(name) {
  return name.split(/\s+(?:feat\.?|ft\.?|with)\s+/i)[0].trim();
}

export default function SearchBar({ onSelect, placeholder = "artiste ou titre..." }) {
  const { playing, stop } = useAudio();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef(null);
  const abortRef = useRef(null);
  const skipSearchRef = useRef(false);

  useEffect(() => {
    if (skipSearchRef.current) {
      skipSearchRef.current = false;
      return;
    }
    if (query.trim().length < 2) { setResults([]); setOpen(false); return; }

    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: abortRef.current.signal,
        });
        const data = await res.json();
        setResults(data);
        setOpen(data.length > 0);
      } catch (e) {
        if (e.name !== "AbortError") setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => {
      clearTimeout(timeoutRef.current);
      abortRef.current?.abort();
    };
  }, [query]);

  function handleSelect(song) {
    if (playing && playing !== song.preview) stop();
    skipSearchRef.current = true;
    setQuery(`${song.artist} — ${song.title}`);
    setOpen(false);
    onSelect(song);
  }

  return (
    <div className="relative w-full">
      <div className="relative flex items-center">
        <input
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => { if (open) stop(); setOpen(false); }}
          className="w-full h-9 border border-border bg-background px-3 text-sm font-mono outline-none focus:border-foreground transition-colors placeholder:text-muted-foreground pr-8"
        />
        {loading && (
          <div className="absolute right-2.5 w-3 h-3 border border-border border-t-foreground rounded-full animate-spin" />
        )}
      </div>

      {open && (
        <ul className="absolute top-full left-0 right-0 z-50 bg-background border border-border border-t-0 max-h-72 overflow-y-auto">
          {results.map((song, i) => (
            <li
              key={i}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(song); }}
              className="flex items-center gap-2 px-2 py-2 cursor-pointer hover:bg-accent border-b border-border last:border-0"
            >
              {song.cover
                ? <img src={song.cover} alt="" width={32} height={32} className="w-8 h-8 object-cover border border-border shrink-0" />
                : <div className="w-8 h-8 border border-border shrink-0 bg-secondary" />
              }
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{song.title}</p>
                <p className="text-xs text-muted-foreground truncate">
                  <Link
                    href={`/artist/${encodeURIComponent(cleanArtist(song.artist))}`}
                    className="hover:underline"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  >
                    {song.artist}
                  </Link>
                  {song.album ? ` · ${song.album}` : ""}
                </p>
              </div>
              <div onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                <PreviewButton url={song.preview} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
