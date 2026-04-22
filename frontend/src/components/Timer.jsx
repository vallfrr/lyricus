"use client";
import { useEffect, useRef, useState } from "react";

export function useTimer() {
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef(null);
  const secondsRef = useRef(0);

  function start() {
    if (running) return;
    setRunning(true);
  }

  function stop() {
    setRunning(false);
  }

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setSeconds((s) => {
          const next = s + 1;
          secondsRef.current = next;
          return next;
        });
      }, 1000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [running]);

  const display = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  function forceSetSeconds(val) {
    setSeconds(val);
    secondsRef.current = val;
  }

  return { seconds, display, running, start, stop, setSeconds: forceSetSeconds, getSeconds: () => secondsRef.current };
}

export function TimerDisplay({ display, running }) {
  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {display}
      {running && <span className="ml-1 opacity-50">●</span>}
    </span>
  );
}
