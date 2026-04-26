"use client";
import { createContext, useContext, useRef, useState, useCallback, useEffect } from "react";

const Ctx = createContext(null);

const VOLUME_KEY = "lyricusPreviewVolume";

/** Deezer CDN URLs with hdnea tokens are IP-bound to the backend.
 *  Route them through our proxy so they play correctly in the browser. */
function resolveUrl(url) {
  if (!url) return url;
  if (url.includes("dzcdn.net")) return `/api/preview?url=${encodeURIComponent(url)}`;
  return url;
}

function getSavedVolume() {
  try { return parseFloat(localStorage.getItem(VOLUME_KEY) ?? "0.5") || 0.5; } catch { return 0.5; }
}

let _saveTimer = null;
function scheduleSaveVolume(v) {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    fetch("/api/auth/me", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preview_volume: v }),
    }).catch(() => {});
  }, 800); // debounce — only save 800ms after last change
}

export function AudioProvider({ children }) {
  const audioRef   = useRef(null);
  const playingRef = useRef(null);
  const [playing, setPlaying] = useState(null);
  const [volume, setVolumeState] = useState(0.5);
  const volumeInitRef = useRef(false); // avoid overwriting DB value with localStorage on mount

  const _ensureAudio = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      const saved = getSavedVolume();
      audioRef.current.volume = saved;
      setVolumeState(saved);
      audioRef.current.onended = () => {
        playingRef.current = null;
        setPlaying(null);
      };
    }
    return audioRef.current;
  }, []);

  /** Called once when the user object is available — sync DB volume → local */
  const initVolumeFromUser = useCallback((userVolume) => {
    if (volumeInitRef.current) return; // only once per session
    volumeInitRef.current = true;
    const v = Math.max(0, Math.min(1, userVolume));
    if (audioRef.current) audioRef.current.volume = v;
    setVolumeState(v);
    try { localStorage.setItem(VOLUME_KEY, String(v)); } catch {}
  }, []);

  const setVolume = useCallback((v) => {
    const clamped = Math.max(0, Math.min(1, v));
    if (audioRef.current) audioRef.current.volume = clamped;
    setVolumeState(clamped);
    try { localStorage.setItem(VOLUME_KEY, String(clamped)); } catch {}
    scheduleSaveVolume(clamped);
  }, []);

  const toggle = useCallback((url) => {
    if (!url) return;
    const resolved = resolveUrl(url);

    if (playingRef.current === url) {
      audioRef.current?.pause();
      playingRef.current = null;
      setPlaying(null);
      return;
    }

    const audio = _ensureAudio();
    audio.pause();
    audio.src = resolved;
    audio.play().catch(() => {
      playingRef.current = null;
      setPlaying(null);
    });
    playingRef.current = url;
    setPlaying(url);
  }, [_ensureAudio]);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    playingRef.current = null;
    setPlaying(null);
  }, []);

  return (
    <Ctx.Provider value={{ playing, toggle, stop, volume, setVolume, initVolumeFromUser }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAudio() {
  return useContext(Ctx);
}
