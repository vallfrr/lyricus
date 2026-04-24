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

export default function FlowGame({ tokens, answers, onReveal, onFirstMatch, onProgress, initialRevealed }) {
  const { t } = useI18n();
  const [revealed, setRevealed] = useState(() => new Set(initialRevealed ?? []));
  const [input, setInput] = useState("");
  const [inputMode, setInputMode] = useState("type");
  const [voiceLang, setVoiceLang] = useState("fr-FR");
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [flash, setFlash] = useState(false);
  const [finished, setFinished] = useState(false);
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
      triggerFlash();
      notifyFirstMatch();
      autoFinishIfComplete(newRevealed);
    }
  }

  // ── Voice: fuzzy match ───────────────────────────────────────────────────
  const startListening = useCallback(() => {
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = voiceLang;
    recognition.maxAlternatives = 3;

    recognition.onresult = (event) => {
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const allCandidates = new Set();
          for (let alt = 0; alt < result.length; alt++) {
            if (result[alt].confidence >= 0.4) {
              for (const w of transcriptWords(result[alt].transcript)) allCandidates.add(w);
            }
          }
          const { newRevealed, matchCount } = matchFuzzy(allCandidates, wordMap, revealedRef.current);
          if (matchCount > 0) {
            revealedRef.current = newRevealed;
            setRevealed(newRevealed);
            triggerFlash();
            notifyFirstMatch();
            autoFinishIfComplete(newRevealed);
          }
          setInterim("");
        } else {
          interimText += result[0].transcript;
          if (result[0].confidence >= 0.65 || result[0].confidence === 0) {
            const candidates = transcriptWords(interimText);
            const { newRevealed, matchCount } = matchFuzzy(candidates, wordMap, revealedRef.current);
            if (matchCount > 0) {
              revealedRef.current = newRevealed;
              setRevealed(newRevealed);
              triggerFlash();
              notifyFirstMatch();
              autoFinishIfComplete(newRevealed);
            }
          }
        }
      }
      if (interimText) setInterim(interimText);
    };

    recognition.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setVoiceUnsupported(true); setListening(false);
      }
    };
    recognition.onend = () => { if (recognitionRef.current === recognition) recognition.start(); };

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [voiceLang]);

  function stopListening() {
    if (recognitionRef.current) { const r = recognitionRef.current; recognitionRef.current = null; r.stop(); }
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
    onReveal?.({
      score: { correct: r.size, total: totalBlanks },
      details: { type: "flow", revealed_ids: [...r], total: totalBlanks },
    });
  }

  useEffect(() => () => stopListening(), []);

  return (
    <div className={`flex flex-col gap-6 ${finished ? "pb-4" : "pb-24"}`}>
      <div className="text-base leading-[3] break-words">
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
                <span key={i} className="inline-flex flex-col items-center align-middle mx-0.5">
                  <span
                    className={cn(
                      "inline-block px-1 border-b-2 text-sm",
                      isRevealed
                        ? "border-foreground font-semibold"
                        : "border-border text-muted-foreground/60 line-through"
                    )}
                    style={{ minWidth: width }}
                  >
                    {isRevealed ? word : "—"}
                  </span>
                  {!isRevealed && (
                    <span className="text-[10px] text-foreground mt-0.5">{word}</span>
                  )}
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
        <div className={cn(
          "fixed bottom-0 left-0 right-0 border-t bg-background p-3 transition-colors",
          flash ? "border-foreground" : "border-border"
        )}>
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
                autoComplete="off"
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

            <button onClick={handleFinish} className="border border-border px-3 h-9 text-xs text-muted-foreground hover:border-foreground hover:text-foreground transition-colors shrink-0">
              {t("flow.end")}
            </button>


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
