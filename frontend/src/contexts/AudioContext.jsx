"use client";
import { createContext, useContext, useRef, useState, useCallback } from "react";

const Ctx = createContext(null);

export function AudioProvider({ children }) {
  const audioRef   = useRef(null);
  const playingRef = useRef(null); // source of truth, avoids stale closure
  const [playing, setPlaying] = useState(null);

  const toggle = useCallback((url) => {
    if (!url) return;

    // Same URL → stop
    if (playingRef.current === url) {
      audioRef.current?.pause();
      playingRef.current = null;
      setPlaying(null);
      return;
    }

    // Create element once
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.onended = () => {
        playingRef.current = null;
        setPlaying(null);
      };
    }

    audioRef.current.pause();
    audioRef.current.src = url;
    audioRef.current.play().catch(() => {
      playingRef.current = null;
      setPlaying(null);
    });
    playingRef.current = url;
    setPlaying(url);
  }, []);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    playingRef.current = null;
    setPlaying(null);
  }, []);

  return <Ctx.Provider value={{ playing, toggle, stop }}>{children}</Ctx.Provider>;
}

export function useAudio() {
  return useContext(Ctx);
}
