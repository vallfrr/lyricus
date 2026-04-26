"use client";
import { useRef, useState, useEffect, useCallback } from "react";
import { Mic, MicOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { normalize, fuzzyMatch, transcriptWords } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useI18n } from "@/contexts/I18nContext";

const SpeechRecognition =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

function buildWordMap(answers) {
  const map = {};
  for (const [id, word] of Object.entries(answers)) {
    const norm = normalize(word);
    if (!map[norm]) map[norm] = [];
    map[norm].push(Number(id));
  }
  return map;
}

// Exact match only (for typed input)
function matchExact(candidate, wordMap, currentRevealed) {
  const newRevealed = new Set(currentRevealed);
  let matched = false;
  const ids = wordMap[candidate];
  if (ids) {
    const newIds = ids.filter((id) => !newRevealed.has(id));
    if (newIds.length > 0) { ids.forEach((id) => newRevealed.add(id)); matched = true; }
  }
  return { newRevealed, matched };
}

// Fuzzy match (for voice input)
function matchFuzzy(candidates, wordMap, currentRevealed) {
  const newRevealed = new Set(currentRevealed);
  let matchCount = 0;
  for (const candidate of candidates) {
    // Exact first
    const exactIds = wordMap[candidate];
    if (exactIds) {
      const newIds = exactIds.filter((id) => !newRevealed.has(id));
      if (newIds.length > 0) { exactIds.forEach((id) => newRevealed.add(id)); matchCount++; continue; }
    }
    // Fuzzy fallback
    for (const [normExpected, ids] of Object.entries(wordMap)) {
      const hasHidden = ids.some((id) => !newRevealed.has(id));
      if (!hasHidden) continue;
      if (fuzzyMatch(candidate, normExpected)) { ids.forEach((id) => newRevealed.add(id)); matchCount++; break; }
    }
  }
  return { newRevealed, matchCount };
}

export default function FlowGame({ tokens, answers, onReveal, onFirstMatch, onProgress, initialRevealed, hideEndButton, autoFinishAt, startFinished, isDaily, onAbandon }) {
  const { t } = useI18n();
  const [revealed, setRevealed] = useState(() => new Set(initialRevealed ?? []));
  const [input, setInput] = useState("");
  const [inputMode, setInputMode] = useState("type");
  const [voiceLang, setVoiceLang] = useState("fr-FR");
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [flash, setFlash] = useState(false);
  const [finished, setFinished] = useState(startFinished ?? false);
  const [firstMatchDone, setFirstMatchDone] = useState(false);
  const [voiceUnsupported, setVoiceUnsupported] = useState(!SpeechRecognition);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const flashTimer = useRef(null);
  const revealedRef = useRef(revealed);

  const blankIds = tokens.filter((t) => t.type === "blank").map((t) => t.id);
  const totalBlanks = blankIds.length;
  const wordMap = buildWordMap(answers);

  useEffect(() => {
    revealedRef.current = revealed;
    onProgress?.({ type: "flow", revealed_ids: [...revealed], total: totalBlanks });
  }, [revealed]);
  useEffect(() => { if (inputMode === "type") inputRef.current?.focus(); }, [inputMode]);

  // Auto-finish at a specific timestamp (e.g. midnight for daily challenges)
  useEffect(() => {
    if (!autoFinishAt || finished) return;
    const msLeft = autoFinishAt - Date.now();
    if (msLeft <= 0) return;
    const id = setTimeout(() => handleFinish(revealedRef.current), msLeft);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFinishAt]);

  function triggerFlash() {
    clearTimeout(flashTimer.current);
    setFlash(true);
    flashTimer.current = setTimeout(() => setFlash(false), 300);
  }

  function notifyFirstMatch() {
    if (!firstMatchDone) { setFirstMatchDone(true); onFirstMatch?.(); }
  }

  // ── Typed input: exact match after normalize ─────────────────────────────
  function autoFinishIfComplete(newRevealed) {
    if (newRevealed.size >= totalBlanks) {
      setTimeout(() => handleFinish(newRevealed), 400);
    }
  }

  function handleTypedInput(e) {
    const value = e.target.value;
    setInput(value);
    const norm = normalize(value);
    if (!norm) return;

    const { newRevealed, matched } = matchExact(norm, wordMap, revealedRef.current);
    if (matched) {
      revealedRef.current = newRevealed;
      setRevealed(newRevealed);
      setInput("");
      // Re-focus after clearing so the keyboard stays open on Android
      setTimeout(() => inputRef.current?.focus(), 0);
      triggerFlash();
      notifyFirstMatch();
      autoFinishIfComplete(newRevealed);
    }
  }

  // ── Voice: fuzzy match ───────────────────────────────────────────────────
  const restartTimerRef = useRef(null);

  function processMatches(candidates) {
    const { newRevealed, matchCount } = matchFuzzy(candidates, wordMap, revealedRef.current);
    if (matchCount > 0) {
      revealedRef.current = newRevealed;
      setRevealed(newRevealed);
      triggerFlash();
      notifyFirstMatch();
      autoFinishIfComplete(newRevealed);
    }
  }

  const startListening = useCallback(() => {
    if (!SpeechRecognition) return;
    clearTimeout(restartTimerRef.current);

    const recognition = new SpeechRecognition();
    // continuous:false is more reliable on Android Chrome —
    // we restart manually in onend instead.
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = voiceLang;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const candidates = new Set(transcriptWords(result[0].transcript));
          processMatches(candidates);
          setInterim("");
        } else {
          interimText += result[0].transcript;
          // Match interim immediately (no confidence gate — Android often reports 0)
          processMatches(new Set(transcriptWords(interimText)));
        }
      }
      if (interimText) setInterim(interimText);
    };

    recognition.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setVoiceUnsupported(true);
        setListening(false);
        recognitionRef.current = null;
      }
      // network / no-speech / aborted: onend will restart
    };

    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      // Restart after short delay to avoid rapid-fire loop on Android
      restartTimerRef.current = setTimeout(() => {
        if (recognitionRef.current !== recognition) return;
        try { recognition.start(); } catch {}
      }, 250);
    };

    recognitionRef.current = recognition;
    try { recognition.start(); } catch {}
    setListening(true);
  }, [voiceLang]);

  function stopListening() {
    clearTimeout(restartTimerRef.current);
    if (recognitionRef.current) {
      const r = recognitionRef.current;
      recognitionRef.current = null;
      r.onend = null;
      r.stop();
    }
    setListening(false);
    setInterim("");
  }

  function toggleInputMode() {
    if (inputMode === "type") { setInputMode("voice"); startListening(); }
    else { setInputMode("type"); stopListening(); }
  }

  function toggleLang() {
    const next = voiceLang === "fr-FR" ? "en-US" : "fr-FR";
    setVoiceLang(next);
    if (listening) { stopListening(); setTimeout(startListening, 100); }
  }

  function handleFinish(revealedOverride) {
    const r = (revealedOverride instanceof Set) ? revealedOverride : revealed;
    stopListening();
    setFinished(true);
    // Unique word scoring: "caca" × 400 = 1 unique word, not 400
    const uniqueTotal   = Object.keys(wordMap).length;
    const uniqueCorrect = Object.keys(wordMap).filter(
      w => wordMap[w].some(id => r.has(id))
    ).length;
    onReveal?.({
      score:   { correct: r.size, total: totalBlanks },
      unique:  { correct: uniqueCorrect, total: uniqueTotal },
      details: { type: "flow", revealed_ids: [...r], total: totalBlanks },
    });
  }

  useEffect(() => () => stopListening(), []);

  return (
    <div className={`flex flex-col gap-6 ${finished ? "pb-4" : "pb-24"}`}>
      <div className="text-base leading-[3] break-words" aria-hidden="true">
        {tokens.map((token, i) => {
          if (token.type === "newline") return <br key={i} />;
          if (token.type === "space") return <span key={i}> </span>;
          if (token.type === "word") return <span key={i}>{token.value}</span>;
          if (token.type === "blank") {
            const id = token.id;
            const isRevealed = revealed.has(id);
            const word = answers[id] ?? "";
            const len = word.length || 3;
            const width = Math.max(len * 9 + 16, 40);

            if (finished) {
              return (
                <span
                  key={i}
                  className={cn(
                    "inline font-semibold border-b mx-0.5",
                    isRevealed
                      ? "border-foreground/40"
                      : "text-red-500 border-red-500/40"
                  )}
                >
                  {word}
                </span>
              );
            }

            return (
              <span
                key={i}
                className={cn(
                  "inline-block mx-0.5 align-middle px-1 py-0.5 text-sm border-b-2 transition-all duration-100",
                  isRevealed ? "border-foreground font-semibold" : "border-border text-transparent bg-secondary select-none"
                )}
                style={{ minWidth: `${Math.max(len * 8, 24)}px` }}
              >
                {isRevealed ? word : "·".repeat(len)}
              </span>
            );
          }
          return null;
        })}
      </div>

      {!finished ? (
        <div
          className={cn(
            "fixed bottom-0 left-0 right-0 border-t bg-background p-3 transition-colors",
            flash ? "border-foreground" : "border-border"
          )}
        >
          <div className="max-w-2xl mx-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0 tabular-nums text-right">
              {revealed.size}/{totalBlanks}
            </span>
            {inputMode === "type" ? (
              <Input
                ref={inputRef}
                value={input}
                onChange={handleTypedInput}
                placeholder={t("flow.type")}
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="new-password"
                data-form-type="other"
                data-gramm="false"
                enterKeyHint="go"
                aria-label="Saisie de mot"
                className="flex-1"
              />
            ) : (
              <div className="flex-1 flex items-center gap-2 bg-secondary border border-border px-3 h-9 min-w-0">
                {listening
                  ? <><span className="w-1.5 h-1.5 bg-foreground animate-pulse shrink-0" /><span className="text-xs text-muted-foreground truncate">{interim || t("flow.listening")}</span></>
                  : <span className="text-xs text-muted-foreground">{t("flow.stopped")}</span>
                }
              </div>
            )}

            {inputMode === "voice" && (
              <button onClick={toggleLang} className="text-[10px] px-1.5 py-1 border border-border text-muted-foreground hover:text-foreground transition-colors shrink-0">
                {voiceLang === "fr-FR" ? "FR" : "EN"}
              </button>
            )}

            {!voiceUnsupported && (
              <button
                onClick={toggleInputMode}
                className={cn(
                  "h-9 w-9 flex items-center justify-center border transition-colors shrink-0",
                  inputMode === "voice" ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground"
                )}
                title={inputMode === "voice" ? "frappe" : "micro"}
              >
                {inputMode === "voice" ? <Mic size={13} /> : <MicOff size={13} />}
              </button>
            )}

            {!hideEndButton && (
              <button onClick={handleFinish} className="border border-border px-3 h-9 text-xs text-muted-foreground hover:border-foreground hover:text-foreground transition-colors shrink-0">
                {t("flow.end")}
              </button>
            )}

            {isDaily && onAbandon && (
              <button
                onClick={onAbandon}
                className="border border-red-500/20 text-red-500/50 px-2 h-9 text-xs hover:border-red-500/60 hover:text-red-500 transition-colors shrink-0 whitespace-nowrap"
                title={t("daily.abandon")}
              >
                ✕
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="border border-border px-4 py-3 flex items-center justify-between mt-2">
          <span className="text-sm tabular-nums font-medium">{revealed.size} / {totalBlanks}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {totalBlanks ? Math.round((revealed.size / totalBlanks) * 100) : 0}%
          </span>
        </div>
      )}
    </div>
  );
}
