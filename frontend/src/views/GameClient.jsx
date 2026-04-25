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

/** Finish a DB session with the final score. Returns points_gained or 0. */
async function finishDbSession(sessionId, data) {
  if (!sessionId) return 0;
  try {
    const r = await fetch(`/api/history/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(data),
    });
    if (r.ok) {
      const json = await r.json();
      return json.points_gained ?? 0;
    }
  } catch {}
  return 0;
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
  const [abandonConfirm, setAbandonConfirm] = useState(false);
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
    if (!user) return;
    const payload = {
      artist: gameData?.song?.artist ?? artist,
      title: gameData?.song?.title ?? title,
      album: gameData?.song?.album ?? album,
      cover,
      difficulty, mode,
      score_correct: data?.score?.correct ?? 0,
      score_total: data?.score?.total ?? 0,
      duration_seconds: timer.seconds,
      details: data?.details ? JSON.stringify(data.details) : null,
    };
    // If we already have an unfinished DB session, patch it; otherwise create a finished session
    let gained = 0;
    if (dbSessionId) {
      gained = await finishDbSession(dbSessionId, payload);
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
        }
      } catch {}
    }
    if (gained > 0) setPointsGained(gained);
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

  function buildChallengeUrl() {
    if (!score) return null;
    const pct = score.total > 0 ? Math.round((score.correct / score.total) * 100) : 0;
    const p = new URLSearchParams({
      artist: gameData?.song?.artist ?? artist,
      title:  gameData?.song?.title ?? title,
      album:  gameData?.song?.album ?? album,
      cover, difficulty,
      challenge_score: String(pct),
      challenge_total: String(score.total),
    });
    if (gameData?.seed != null) p.set("seed", String(gameData.seed));
    if (user?.name) p.set("from", user.name);
    return `${window.location.origin}/challenge?${p}`;
  }

  async function handleAbandon() {
    // Capture found IDs before clearing progress
    const revealedIds = latestDataRef.current?.revealed_ids ?? [];
    try {
      const r = await fetch("/api/daily/abandon", { method: "POST", credentials: "include" });
      if (r.ok) {
        clearProgress(artist, title, difficulty, mode);
        if (dbSessionId) discardDbSession(dbSessionId);
        // Store found IDs in localStorage so correction view can show found vs missed
        try {
          const today = new Date().toISOString().split("T")[0];
          localStorage.setItem(`lyricusDailyFoundIds_${today}`, JSON.stringify({
            artist, title, seed: gameData?.seed ?? null, found_ids: revealedIds,
          }));
        } catch {}
        router.push("/");
      }
    } catch {}
  }

  async function handleCopyChallenge() {
    const url = buildChallengeUrl();
    if (!url) return;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      } else {
        const el = document.createElement("textarea");
        el.value = url;
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
  const challengeWon = myPct !== null && theirPct !== null && myPct >= theirPct;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background h-10 px-4 flex items-center gap-3">
        <Link href="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0">
          {t("game.back")}
        </Link>
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
          <span className="border border-border px-1.5 py-0.5">{DIFF_LABELS[difficulty] ?? difficulty}</span>
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
          {t("daily.title")}
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

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8">
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
            onFirstMatch={timer.start}
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
          />
        )}

        <div ref={finishedRef} />

        {finished && pointsGained > 0 && (
          <div className="flex items-center justify-center gap-1.5 py-3 text-sm font-medium text-foreground mb-1">
            <span className="text-green-500 font-semibold tabular-nums">+{pointsGained} pts</span>
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
                    <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{t("game.challenge.you")}</span>
                  </div>
                  <div className="text-muted-foreground self-center text-xs">vs</div>
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-xl font-semibold">{theirPct}%</span>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{challengeFrom || t("game.challenge.them")}</span>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                  {challengeWon ? t("game.challenge.won") : t("game.challenge.lost")}
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
                  onClick={handleCopyChallenge}
                  className="flex-1 border border-border px-3 py-2 text-xs text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
                >
                  {copied ? t("game.copied") : t("game.defier")}
                </button>
              )}
            </div>

            <Link
              href="/"
              className="w-full max-w-xs border border-foreground px-4 py-2.5 text-sm font-medium text-center hover:bg-foreground hover:text-background transition-colors"
            >
              {t("game.new")}
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
