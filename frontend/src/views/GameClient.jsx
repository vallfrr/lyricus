"use client";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useTimer, TimerDisplay } from "@/components/Timer";
import ThemeToggle from "@/components/ThemeToggle";
import { LyricsSkeleton } from "@/components/Skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { track } from "@/lib/analytics";

const LyricsGame = dynamic(() => import("@/components/LyricsGame"), { ssr: false });
const FlowGame   = dynamic(() => import("@/components/FlowGame"),   { ssr: false });

const DIFF_ORDER = ["easy", "medium", "hard", "extreme"];

function progressKey(artist, title, difficulty, mode) {
  return `lyricusProgress_${encodeURIComponent(artist)}_${encodeURIComponent(title)}_${difficulty}_${mode}`;
}

function loadProgress(artist, title, difficulty, mode) {
  try {
    const raw = localStorage.getItem(progressKey(artist, title, difficulty, mode));
    if (!raw) return null;
    const saved = JSON.parse(raw);
    // Discard stale progress older than 7 days
    if (Date.now() - saved.savedAt > 7 * 24 * 3600 * 1000) return null;
    return saved;
  } catch { return null; }
}

function saveProgress(artist, title, difficulty, mode, cover, data) {
  try {
    localStorage.setItem(
      progressKey(artist, title, difficulty, mode),
      JSON.stringify({ savedAt: Date.now(), artist, title, difficulty, mode, cover, ...data }),
    );
  } catch {}
}

function clearProgress(artist, title, difficulty, mode) {
  try { localStorage.removeItem(progressKey(artist, title, difficulty, mode)); } catch {}
}

/** Start an unfinished DB session with the game's seed; returns id or null. */
async function startDbSession(artist, title, album, cover, difficulty, mode, seed, isDaily = false) {
  try {
    const r = await fetch("/api/history/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ artist, title, album, cover, difficulty, mode, seed, is_daily: isDaily }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.id ?? null;
  } catch { return null; }
}

/** Update an unfinished DB session with the user's progress. */
async function updateDbProgress(sessionId, data) {
  if (!sessionId) return;
  try {
    await fetch(`/api/history/${sessionId}/progress`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(data),
    });
  } catch {}
}

/** Finish a DB session with the final score. Returns { points_gained, song_best }. */
async function finishDbSession(sessionId, data) {
  if (!sessionId) return { points_gained: 0, song_best: 0 };
  try {
    const r = await fetch(`/api/history/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(data),
    });
    if (r.ok) {
      const json = await r.json();
      return { points_gained: json.points_gained ?? 0, song_best: json.song_best ?? 0 };
    }
  } catch {}
  return { points_gained: 0, song_best: 0 };
}

/** Delete an unfinished DB session (user discards it). */
async function discardDbSession(sessionId) {
  if (!sessionId) return;
  try {
    await fetch(`/api/history/${sessionId}`, {
      method: "DELETE",
      credentials: "include",
    });
  } catch {}
}

export default function GameClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useI18n();
  const [gameData, setGameData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [finished, setFinished] = useState(false);
  const [score, setScore] = useState(null);
  const [copied, setCopied] = useState(false);
  const [newBadges, setNewBadges] = useState([]);
  const [pointsGained, setPointsGained] = useState(0);
  const [breakdown, setBreakdown] = useState(null);
  const [abandonConfirm, setAbandonConfirm] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [forceReveal, setForceReveal] = useState(null);
  const pendingPayloadRef = useRef(null);
  const [savedProgress, setSavedProgress] = useState(null);
  const [resumeDecided, setResumeDecided] = useState(false);
  const [initialProgress, setInitialProgress] = useState(null);
  const [dbSessionId, setDbSessionId] = useState(null);
  const timer = useTimer();
  const latestDataRef = useRef(null);
  const lastProgressTimeRef = useRef(Date.now());
  const finishedRef = useRef(null);

  const artist     = searchParams.get("artist") ?? "";
  const title      = searchParams.get("title") ?? "";
  const album      = searchParams.get("album") ?? "";
  const cover      = searchParams.get("cover") ?? "";
  const difficulty = searchParams.get("difficulty") ?? "medium";
  const seedParam  = searchParams.get("seed") ?? "";
  const mode       = "flow";

  const challengeScore = searchParams.get("challenge_score");
  const challengeTotal = searchParams.get("challenge_total");
  const challengeFrom  = searchParams.get("from");
  const isChallenge = !!challengeScore && !!challengeTotal;
  const isDaily    = searchParams.get("is_daily") === "1";
  const revealAll  = searchParams.get("reveal_all") === "1";
  const autoResume = searchParams.get("resume") === "1";
  // found_ids: comma-separated blank IDs the user actually found (passed after abandon)
  // null = generic correction (show all), "" = abandoned with 0 found (show all red), "1,2,3" = partial
  const foundIdsParam = searchParams.get("found_ids");
  const foundIds = foundIdsParam !== null
    ? new Set(foundIdsParam ? foundIdsParam.split(",").map(Number) : [])
    : null;

  // Timestamp of next UTC midnight (for daily auto-stop)
  const midnightMs = useMemo(() => {
    if (!isDaily) return null;
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  }, [isDaily]);

  const DIFF_LABELS = {
    easy: t("diff.easy"), medium: t("diff.medium"),
    hard: t("diff.hard"), extreme: t("diff.extreme"),
  };

  useEffect(() => {
    if (!artist || !title) { router.replace("/"); return; }

    const sessionId = searchParams.get("session_id");

    if (sessionId) {
      // Resume from DB session — fetch stored tokens directly
      setDbSessionId(sessionId);
      fetch(`/api/history/${sessionId}`, { credentials: "include" })
        .then((r) => { if (!r.ok) throw new Error(t("game.error.notfound")); return r.json(); })
        .then((session) => {
          if (!session.game_tokens) throw new Error(t("game.error.notfound"));
          // Build a gameData-compatible object from the stored session
          setGameData({
            seed:         session.seed,
            tokens:       session.game_tokens,
            answer_token: session.game_answer_token,
            answers:      session.game_answers,
            song: {
              artist: session.artist,
              title:  session.title,
              album:  session.album,
            },
          });
          
          if (session.details) {
            try {
              const details = JSON.parse(session.details);
              setInitialProgress(details);
              latestDataRef.current = details;
              if (details.timer) timer.setSeconds(details.timer);
            } catch {
              setInitialProgress(null);
            }
          } else {
            setInitialProgress(null);
          }
          setResumeDecided(true);
          if (session.details) timer.start();
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
      return;
    }

    // No session_id — standard flow: check localStorage then fetch lyrics
    // In correction/reveal mode, skip saved progress entirely
    if (!revealAll) {
      const saved = loadProgress(artist, title, difficulty, mode);
      if (saved) {
        setSavedProgress(saved);
      } else {
        setResumeDecided(true);
      }
    } else {
      setResumeDecided(true);
    }
    const p = new URLSearchParams({ artist, title, difficulty });
    if (album) p.set("album", album);
    if (seedParam) p.set("seed", seedParam);
    fetch(`/api/lyrics?${p}`, { credentials: "include" })
      .then((r) => { if (!r.ok) throw new Error(t("game.error.notfound")); return r.json(); })
      .then((d) => { setGameData(d); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function handleResume() {
    setInitialProgress(savedProgress);
    if (savedProgress) latestDataRef.current = savedProgress;
    if (savedProgress?.timer) timer.setSeconds(savedProgress.timer);
    // Re-use the existing DB session id stored in saved progress
    if (savedProgress?.dbSessionId) setDbSessionId(savedProgress.dbSessionId);
    setResumeDecided(true);
    timer.start();
  }

  function handleNewGame() {
    // Discard the old unfinished DB session
    if (savedProgress?.dbSessionId) discardDbSession(savedProgress.dbSessionId);
    clearProgress(artist, title, difficulty, mode);
    setSavedProgress(null);
    setInitialProgress(null);
    setDbSessionId(null);
    setResumeDecided(true);
  }

  const handleProgress = useCallback((data) => {
    if (revealAll) return; // Correction view — never write progress
    latestDataRef.current = data;
    lastProgressTimeRef.current = Date.now();
    const dbDetails = { ...data, timer: timer.getSeconds() };
    saveProgress(artist, title, difficulty, mode, cover, {
      ...dbDetails,
      seed:          gameData?.seed,
      tokens:        gameData?.tokens,
      answerToken:   gameData?.answer_token,
      answers:       gameData?.answers,
      dbSessionId,
    });
    if (dbSessionId) {
      updateDbProgress(dbSessionId, dbDetails);
    }
  }, [artist, title, difficulty, mode, cover, gameData, dbSessionId]);

  // When resume=1 is in URL (from DailyCard or history), skip the banner and auto-resume
  useEffect(() => {
    if (!autoResume || !savedProgress || !gameData || resumeDecided) return;
    setInitialProgress(savedProgress);
    latestDataRef.current = savedProgress;
    if (savedProgress?.timer) timer.setSeconds(savedProgress.timer);
    if (savedProgress?.dbSessionId) setDbSessionId(savedProgress.dbSessionId);
    setResumeDecided(true);
    timer.start();
  }, [autoResume, savedProgress, gameData, resumeDecided]); // eslint-disable-line react-hooks/exhaustive-deps

  // When in correction/reveal mode, set finished state as soon as lyrics load
  useEffect(() => {
    if (!revealAll || !gameData || finished) return;
    const blanks = gameData.tokens.filter(t => t.type === "blank");
    setFinished(true);
    setScore({ correct: blanks.length, total: blanks.length });
  }, [revealAll, gameData]); // eslint-disable-line react-hooks/exhaustive-deps

  // When a new game actually starts (no resume), create an unfinished DB session with the tokens
  useEffect(() => {
    if (revealAll) return; // No DB session for correction view
    if (!resumeDecided || dbSessionId || !user || !gameData) return;
    // Only start a DB session for fresh games (initialProgress === null)
    if (initialProgress !== null) return;
    const song = gameData.song;
    startDbSession(
      song?.artist ?? artist,
      song?.title  ?? title,
      song?.album  ?? album,
      cover,
      difficulty,
      mode,
      gameData.seed,
      isDaily,
    ).then((id) => {
      if (id) setDbSessionId(id);
    });
  }, [resumeDecided, dbSessionId, user, gameData, initialProgress, artist, title, album, cover, difficulty, mode, isDaily, revealAll]);

  useEffect(() => {
    if (!timer.running) return;
    const interval = setInterval(() => {
      // Only auto-save if more than 5 seconds have passed since the last progress update
      if (Date.now() - lastProgressTimeRef.current <= 5000) return;

      const data = latestDataRef.current || {};
      const currentSeconds = timer.getSeconds();
      const dbDetails = { ...data, timer: currentSeconds };

      // Ensure flow type is correctly initialized if no progress was made yet
      if (mode === "flow" && !dbDetails.type) {
         dbDetails.type = "flow";
         dbDetails.revealed_ids = initialProgress?.revealed_ids || initialProgress?.revealed || [];
         dbDetails.total = gameData?.tokens?.filter(t => t.type === "blank").length || 0;
      }

      saveProgress(artist, title, difficulty, mode, cover, {
        ...dbDetails,
        seed:          gameData?.seed,
        tokens:        gameData?.tokens,
        answerToken:   gameData?.answer_token,
        answers:       gameData?.answers,
        dbSessionId,
      });
      if (dbSessionId) {
        updateDbProgress(dbSessionId, dbDetails);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [timer.running, dbSessionId, artist, title, difficulty, mode, cover, gameData, initialProgress]);

  const handleReveal = useCallback(async (data) => {
    if (revealAll) return; // Correction view — don't save to DB
    timer.stop();
    setFinished(true);
    setScore(data?.score ?? null);
    clearProgress(artist, title, difficulty, mode);
    const pct = data?.score?.total > 0
      ? Math.round(data.score.correct * 100 / data.score.total) : 0;
    track("game_finished", { difficulty, mode, score_pct: pct, duration: timer.seconds, is_daily: isDaily });
    const payload = {
      artist: gameData?.song?.artist ?? artist,
      title: gameData?.song?.title ?? title,
      album: gameData?.song?.album ?? album,
      cover,
      difficulty, mode,
      score_correct:   data?.score?.correct  ?? 0,
      score_total:     data?.score?.total    ?? 0,
      unique_correct:  data?.unique?.correct ?? null,
      unique_total:    data?.unique?.total   ?? null,
      duration_seconds: timer.seconds,
      details: data?.details ? JSON.stringify(data.details) : null,
    };
    const MULTIPLIERS = { easy: 1.0, medium: 1.5, hard: 2.5, extreme: 4.0 };
    const mult = MULTIPLIERS[difficulty] ?? 1.0;
    const uniqueFound   = data?.unique?.found   ?? (data?.unique?.correct ?? 0);
    const hintedCount   = data?.unique?.hinted  ?? 0;
    const uniqueCorrect = data?.unique?.correct  ?? 0;
    const netPoints = Math.round(uniqueCorrect * mult);

    if (!user) { pendingPayloadRef.current = payload; return; }
    // If we already have an unfinished DB session, patch it; otherwise create a finished session
    let gained = 0;
    let songBest = 0;
    if (dbSessionId) {
      ({ points_gained: gained, song_best: songBest } = await finishDbSession(dbSessionId, payload));
    } else {
      try {
        const r = await fetch("/api/history/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        if (r.ok) {
          const d = await r.json();
          gained = d.points_gained ?? 0;
          songBest = d.song_best ?? 0;
        }
      } catch {}
    }
    if (gained > 0) setPointsGained(gained);
    // previousBest = what this song was worth before this session
    const previousBest = songBest - gained;
    setBreakdown({ uniqueFound, hintedCount, uniqueCorrect, multiplier: mult, netPoints, previousBest, gained });
    // Check for newly unlocked badges
    try {
      const br = await fetch("/api/badges/check", { method: "POST", credentials: "include" });
      if (br.ok) {
        const bd = await br.json();
        if (bd.new_badges?.length > 0) setNewBadges(bd.new_badges);
      }
    } catch {}
  }, [user, gameData, artist, title, album, cover, difficulty, mode, timer, dbSessionId]);

  function buildGameUrl(overrides = {}) {
    const p = new URLSearchParams({
      artist: gameData?.song?.artist ?? artist,
      title:  gameData?.song?.title ?? title,
      album:  gameData?.song?.album ?? album,
      cover, difficulty, mode,
      ...overrides,
    });
    return `/game?${p}`;
  }

  function buildShareUrl() {
    if (!score) return null;
    const pct = score.total > 0 ? Math.round((score.correct / score.total) * 100) : 0;
    const p = new URLSearchParams({
      artist: gameData?.song?.artist ?? artist,
      title:  gameData?.song?.title ?? title,
      difficulty,
      challenge_score: String(pct),
      challenge_total: String(score.total),
    });
    if (gameData?.seed != null) p.set("seed", String(gameData.seed));
    if (user?.name) p.set("from", user.name);
    return `${window.location.origin}/challenge?${p}`;
  }

  function buildShareText() {
    if (!score) return null;
    const pct = score.total > 0 ? Math.round((score.correct / score.total) * 100) : 0;
    const songTitle = gameData?.song?.title ?? title;
    const songArtist = gameData?.song?.artist ?? artist;
    const url = buildShareUrl();
    const text = t("game.share.text")
      .replace("{score}", pct)
      .replace("{title}", songTitle)
      .replace("{artist}", songArtist);
    return `${text}\n${url}`;
  }

  async function handleAbandon() {
    track("daily_abandoned", { difficulty });
    const revealedIds = latestDataRef.current?.revealed_ids ?? [];
    const foundSet = new Set(revealedIds.map(Number));
    const totalBlanks = gameData?.tokens?.filter(t => t.type === "blank").length ?? 0;
    try {
      const r = await fetch("/api/daily/abandon", { method: "POST", credentials: "include" });
      if (r.ok) {
        clearProgress(artist, title, difficulty, mode);
        // Finish session (don't discard) so found_ids persist for yesterday's correction
        if (dbSessionId) {
          await finishDbSession(dbSessionId, {
            artist: gameData?.song?.artist ?? artist,
            title:  gameData?.song?.title ?? title,
            album:  gameData?.song?.album ?? album,
            cover, difficulty, mode,
            score_correct:    foundSet.size,
            score_total:      totalBlanks,
            unique_correct:   null,
            unique_total:     null,
            duration_seconds: timer.seconds,
            details: JSON.stringify({ type: "flow", revealed_ids: revealedIds, total: totalBlanks }),
          });
        }
        // Store in localStorage for same-session reference
        try {
          const today = new Date().toISOString().split("T")[0];
          localStorage.setItem(`lyricusDailyFoundIds_${today}`, JSON.stringify({
            artist, title, seed: gameData?.seed ?? null, found_ids: revealedIds,
          }));
        } catch {}
        // Show correction in-place — don't navigate away
        setForceReveal(foundSet);
        setFinished(true);
        setScore({ correct: foundSet.size, total: totalBlanks });
      }
    } catch {}
  }

  function handleSaveAndLogin() {
    if (pendingPayloadRef.current) {
      try { localStorage.setItem("lyricusPendingGame", JSON.stringify(pendingPayloadRef.current)); } catch {}
    }
    router.push("/login");
  }

  async function handleShare() {
    const text = buildShareText();
    if (!text) return;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      } else {
        const el = document.createElement("textarea");
        el.value = text;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
    } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  useEffect(() => {
    if (finished && finishedRef.current) {
      finishedRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [finished]);

  const nextDiff = DIFF_ORDER[Math.min(DIFF_ORDER.indexOf(difficulty) + 1, DIFF_ORDER.length - 1)];
  const canGoHarder = nextDiff !== difficulty;

  const myPct = score && score.total > 0 ? Math.round((score.correct / score.total) * 100) : null;
  const theirPct = isChallenge ? Number(challengeScore) : null;
  const challengeTie = myPct !== null && theirPct !== null && myPct === theirPct;
  const challengeWon = myPct !== null && theirPct !== null && myPct > theirPct;

  const gameContainerRef = useRef(null);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => {
      const el = gameContainerRef.current;
      if (!el) return;
      if (mq.matches) {
        // Mobile: pin container to visual viewport so input bar stays above keyboard
        el.style.position = "fixed";
        el.style.left = "0";
        el.style.right = "0";
        el.style.top = vv.offsetTop + "px";
        el.style.height = vv.height + "px";
        el.style.minHeight = "0"; // override min-h-screen so JS height wins
        el.style.transform = "translate(0,0)";
        el.style.overflow = "hidden";
      } else {
        // Desktop: normal page scroll
        el.style.position = "";
        el.style.left = "";
        el.style.right = "";
        el.style.top = "";
        el.style.height = "";
        el.style.minHeight = "";
        el.style.transform = "";
        el.style.overflow = "";
      }
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    mq.addEventListener("change", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      mq.removeEventListener("change", update);
    };
  }, []);

  return (
    <div ref={gameContainerRef} className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background h-10 px-4 flex items-center gap-3">
        {finished && !user && !revealAll ? (
          <button onClick={() => setLeaveConfirm(true)} className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0">
            {t("game.back")}
          </button>
        ) : (
          <Link href="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0">
            {t("game.back")}
          </Link>
        )}
        <div className="flex-1 min-w-0 flex items-baseline gap-2">
          {gameData && (
            <>
              <span className="text-sm font-medium truncate">{gameData.song.title}</span>
              <Link
                href={`/artist/${encodeURIComponent((gameData.song.artist || "").split(/\s+(?:feat\.?|ft\.?|with)\s+/i)[0].trim())}`}
                className="text-xs text-muted-foreground truncate hidden sm:inline hover:underline"
              >{gameData.song.artist}</Link>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
          <ThemeToggle />
          <TimerDisplay display={timer.display} running={timer.running} />
          <span className="border border-border px-1.5 py-0.5 hidden sm:inline">{DIFF_LABELS[difficulty] ?? difficulty}</span>
        </div>
        {cover && <img src={cover} alt="cover" width={28} height={28} className="w-7 h-7 object-cover border border-border shrink-0" />}
      </header>

      {isChallenge && !finished && (
        <div className="border-b border-border bg-secondary/30 px-4 py-2 text-xs text-muted-foreground text-center">
          {challengeFrom
            ? <><span className="text-foreground font-medium">{challengeFrom}</span> {t("game.challenge.from_txt")} · {t("game.challenge.score_txt")} : <span className="text-foreground font-medium tabular-nums">{challengeScore}%</span></>
            : <>{t("game.challenge.score_txt")} : <span className="text-foreground font-medium tabular-nums">{challengeScore}%</span></>
          }
        </div>
      )}
      {revealAll && (
        <div className="border-b border-border bg-secondary/30 px-4 py-2 text-xs text-muted-foreground text-center">
          {t("game.correction")}
        </div>
      )}
      {isDaily && !finished && !revealAll && (
        <div className="border-b border-border bg-secondary/30 px-4 py-2 text-xs text-muted-foreground text-center">
          {t("daily.title")} · {t("daily.rule_90")}
        </div>
      )}

      {/* Resume banner — only shown when NOT arriving via an explicit resume button */}
      {savedProgress && !resumeDecided && gameData && !revealAll && !autoResume && (
        <div className="border-b border-border bg-secondary/40 px-4 py-3 flex items-center justify-between gap-4 max-w-2xl mx-auto w-full">
          <span className="text-xs text-muted-foreground">{t("game.resume.prompt")}</span>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={handleResume}
              className="text-xs border border-foreground px-3 py-1 hover:bg-foreground hover:text-background transition-colors"
            >
              {t("game.resume")}
            </button>
            <button
              onClick={handleNewGame}
              className="text-xs border border-border px-3 py-1 text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
            >
              {t("game.restart")}
            </button>
          </div>
        </div>
      )}

      {/* Abandon confirmation modal */}
      {abandonConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm" onClick={() => setAbandonConfirm(false)}>
          <div
            className="border border-border bg-background p-6 flex flex-col gap-4 max-w-xs w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium">{t("daily.abandon.confirm")}</p>
              <p className="text-xs text-muted-foreground">{t("daily.abandon.confirm.desc")}</p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setAbandonConfirm(false)}
                className="border border-border px-4 py-1.5 text-xs text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
              >
                {t("settings.cancel")}
              </button>
              <button
                onClick={() => { setAbandonConfirm(false); handleAbandon(); }}
                className="border border-red-500/40 text-red-500 px-4 py-1.5 text-xs hover:bg-red-500/10 transition-colors"
              >
                {t("daily.abandon")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leave confirmation modal (for non-logged-in users who finished a game) */}
      {leaveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm" onClick={() => setLeaveConfirm(false)}>
          <div
            className="border border-border bg-background p-6 flex flex-col gap-4 max-w-xs w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium">{t("game.leave.title")}</p>
              <p className="text-xs text-muted-foreground">{t("game.leave.desc")}</p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleSaveAndLogin}
                className="border border-foreground px-4 py-2 text-xs font-medium hover:bg-foreground hover:text-background transition-colors"
              >
                {t("game.leave.save")}
              </button>
              <button
                onClick={() => router.push("/")}
                className="border border-border px-4 py-2 text-xs text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
              >
                {t("game.leave.quit")}
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 overflow-y-auto sm:overflow-y-visible max-w-2xl mx-auto w-full px-4 py-8">
        {loading && <LyricsSkeleton />}

        {error && (
          <div className="border border-border p-5 flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Link href="/" className="text-xs border border-border px-3 py-1.5 self-start hover:border-foreground transition-colors">
              {t("game.return")}
            </Link>
          </div>
        )}

        {gameData && (savedProgress === null || resumeDecided || revealAll) && (
          <FlowGame
            tokens={initialProgress?.tokens ?? gameData.tokens}
            answers={initialProgress?.answers ?? gameData.answers}
            onReveal={handleReveal}
            onFirstMatch={() => { timer.start(); track("game_started", { difficulty, mode, is_daily: isDaily }); }}
            onProgress={handleProgress}
            initialRevealed={
              revealAll
                ? foundIds
                  // After abandon: show only what the user found (rest shown in red)
                  ? gameData.tokens.filter(t => t.type === "blank" && foundIds.has(t.id)).map(t => t.id)
                  // Generic correction (yesterday): show all words
                  : gameData.tokens.filter(t => t.type === "blank").map(t => t.id)
                : (initialProgress?.type === "flow" ? (initialProgress.revealed_ids || initialProgress.revealed) : undefined)
            }
            startFinished={revealAll}
            hideEndButton={isDaily}
            autoFinishAt={midnightMs}
            isDaily={isDaily && !revealAll}
            onAbandon={isDaily && !revealAll ? () => setAbandonConfirm(true) : undefined}
            forceReveal={forceReveal}
          />
        )}

        <div ref={finishedRef} />

        {finished && breakdown && !revealAll && user && (
          <div className="border border-border bg-secondary/20 px-4 py-3 mb-4 text-xs w-full max-w-2xl">
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-muted-foreground">
                <span>{t("game.breakdown.uniques")}</span>
                <span className="tabular-nums font-medium text-foreground">{breakdown.uniqueFound}</span>
              </div>
              {breakdown.hintedCount > 0 && (<>
                <div className="flex justify-between text-amber-400/80">
                  <span>{t("game.breakdown.hints")}</span>
                  <span className="tabular-nums font-medium">−{breakdown.hintedCount}</span>
                </div>
                <div className="border-t border-border/50 pt-1.5 flex justify-between text-amber-400/80">
                  <span>{t("game.breakdown.counted")}</span>
                  <span className="tabular-nums font-medium">{breakdown.uniqueCorrect}</span>
                </div>
              </>)}
              <div className={`flex justify-between text-muted-foreground ${breakdown.hintedCount === 0 ? "border-t border-border/50 pt-1.5" : ""}`}>
                <span>{t("game.breakdown.mult")}</span>
                <span className="tabular-nums font-medium text-foreground">×{breakdown.multiplier}</span>
              </div>
              <div className="border-t border-border/50 pt-1.5 flex justify-between text-muted-foreground">
                <span>{t("game.breakdown.net")}</span>
                <span className="tabular-nums font-medium text-foreground">{breakdown.netPoints} pts</span>
              </div>
              {breakdown.previousBest > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>{t("game.breakdown.prev")}</span>
                  <span className="tabular-nums font-medium">−{breakdown.previousBest} pts</span>
                </div>
              )}
              <div className="border-t border-border/50 pt-1.5 flex justify-between">
                <span className="text-muted-foreground">{t("game.breakdown.gained")}</span>
                <span className={`tabular-nums font-semibold ${breakdown.gained > 0 ? "text-green-500" : "text-muted-foreground"}`}>
                  {breakdown.gained > 0 ? `+${breakdown.gained}` : breakdown.gained} pts
                </span>
              </div>
            </div>
          </div>
        )}

        {finished && newBadges.length > 0 && (
          <div className="border border-border bg-secondary/30 px-4 py-3 flex flex-col gap-2 mb-4">
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest">🏅 {t("game.new_badges")}</span>
            <div className="flex flex-wrap gap-2">
              {newBadges.map((b) => (
                <span key={b.id} className="text-xs border border-border px-2 py-1" title={t(`badge.${b.id}.desc`) || b.desc}>{t(`badge.${b.id}.label`) || b.label}</span>
              ))}
            </div>
          </div>
        )}

        {finished && (
          <div className="flex flex-col items-center gap-5 mt-4">
            {isChallenge && myPct !== null && (
              <div className="border border-border px-5 py-4 flex flex-col items-center gap-2 w-full max-w-xs text-center">
                <div className="flex gap-8 text-sm tabular-nums">
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-xl font-semibold">{myPct}%</span>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{user?.name || t("game.challenge.you")}</span>
                  </div>
                  <div className="text-muted-foreground self-center text-xs">vs</div>
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-xl font-semibold">{theirPct}%</span>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{challengeFrom || t("game.challenge.them")}</span>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                  {challengeTie ? t("game.challenge.tie") : challengeWon ? t("game.challenge.won") : t("game.challenge.lost")}
                </p>
              </div>
            )}

            <div className="flex gap-2 w-full max-w-xs">
              <Link
                href={`/artist/${encodeURIComponent((gameData?.song?.artist ?? artist).split(/\s+(?:feat\.?|ft\.?|with)\s+/i)[0].trim())}`}
                className="flex-1 border border-border px-3 py-2 text-xs text-center text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
              >
                {t("history.artist")}
              </Link>
              {!isDaily && !revealAll && (
                <button
                  onClick={handleShare}
                  className="flex-1 border border-border px-3 py-2 text-xs text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
                >
                  {copied ? t("game.copied") : t("game.defier")}
                </button>
              )}
            </div>

            {!user && !revealAll && (
              <button
                onClick={handleSaveAndLogin}
                className="w-full max-w-xs border border-foreground px-4 py-2.5 text-sm font-medium text-center hover:bg-foreground hover:text-background transition-colors"
              >
                {t("game.save_progress")}
              </button>
            )}

            <Link
              href="/"
              className={`w-full max-w-xs border px-4 py-2.5 text-sm font-medium text-center transition-colors ${!user && !revealAll ? "border-border text-muted-foreground hover:border-foreground hover:text-foreground" : "border-foreground hover:bg-foreground hover:text-background"}`}
            >
              {t("game.new")}
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
