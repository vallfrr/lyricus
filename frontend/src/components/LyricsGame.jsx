"use client";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/contexts/I18nContext";

export default function LyricsGame({ tokens, answerToken, onReveal, onFirstMatch, onProgress, initialAnswers }) {
  const { t } = useI18n();
  const [userAnswers, setUserAnswers] = useState(initialAnswers ?? {});
  const [results, setResults] = useState(null);
  const [correctAnswers, setCorrectAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [firstMatchDone, setFirstMatchDone] = useState(false);
  const inputRefs = useRef({});

  const blankIds = tokens.filter((tk) => tk.type === "blank").map((tk) => tk.id);

  function focusNext(currentId) {
    const idx = blankIds.indexOf(currentId);
    for (let i = idx + 1; i < blankIds.length; i++) {
      inputRefs.current[blankIds[i]]?.focus();
      return;
    }
  }

  function handleChange(id, value) {
    const next = { ...userAnswers, [id]: value };
    setUserAnswers(next);
    onProgress?.({ type: "normal", answers: next });
    if (!firstMatchDone && value.trim()) {
      setFirstMatchDone(true);
      onFirstMatch?.();
    }
  }

  async function handleFinish() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ answers: userAnswers, token: answerToken }),
      });
      const data = await res.json();
      setResults(data.results);
      setCorrectAnswers(data.correct_answers ?? {});
      onReveal?.({
        score: { correct: data.correct, total: data.total },
        details: {
          type: "normal",
          items: blankIds.map((id) => ({
            id,
            correct: !!data.results?.[id],
            attempt: userAnswers[id] ?? "",
            expected: data.correct_answers?.[id] ?? "",
          })),
        },
      });
    } catch {
      // fallback: mark all wrong
      const res = {};
      for (const id of blankIds) res[id] = false;
      setResults(res);
      onReveal?.({ score: { correct: 0, total: blankIds.length } });
    } finally {
      setSubmitting(false);
    }
  }

  const revealed = results !== null;
  const score = revealed ? Object.values(results).filter(Boolean).length : 0;
  const total = blankIds.length;
  const pct   = total ? Math.round((score / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-8">
      {revealed && (
        <div className="border border-border px-4 py-3 flex items-center justify-between">
          <span className="text-sm tabular-nums font-medium">{score} / {total}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{pct}%</span>
        </div>
      )}

      <div className="text-base leading-[3] break-words">
        {tokens.map((token, i) => {
          if (token.type === "newline") return <br key={i} />;
          if (token.type === "space")   return <span key={i}> </span>;
          if (token.type === "word")    return <span key={i}>{token.value}</span>;

          if (token.type === "blank") {
            const id = token.id;
            const expected = correctAnswers[id] ?? "";
            const width = Math.max((expected.length || 4) * 9 + 16, 40);

            if (revealed) {
              const isOk = results[id];
              return (
                <span key={i} className="inline-flex flex-col items-center align-middle mx-0.5">
                  <span
                    className={cn(
                      "inline-block px-1 border-b-2 text-sm",
                      isOk
                        ? "border-foreground font-semibold"
                        : "border-border text-muted-foreground/60 line-through"
                    )}
                    style={{ minWidth: width }}
                  >
                    {userAnswers[id] || "—"}
                  </span>
                  {!isOk && expected && (
                    <span className="text-[10px] text-foreground mt-0.5">{expected}</span>
                  )}
                </span>
              );
            }

            return (
              <span key={i} className="inline-block align-middle mx-0.5">
                <input
                  ref={(el) => (inputRefs.current[id] = el)}
                  style={{ width }}
                  className="bg-transparent border-b-2 border-border focus:border-foreground text-center text-sm outline-none transition-colors px-1 py-0.5"
                  type="text"
                  value={userAnswers[id] ?? ""}
                  onChange={(e) => handleChange(id, e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), focusNext(id))}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </span>
            );
          }
          return null;
        })}
      </div>

      {!revealed && (
        <button
          onClick={handleFinish}
          disabled={submitting}
          className="self-center border border-foreground px-8 py-2 text-sm hover:bg-foreground hover:text-background transition-colors disabled:opacity-50"
        >
          {submitting ? "…" : t("game.finish")}
        </button>
      )}
    </div>
  );
}
