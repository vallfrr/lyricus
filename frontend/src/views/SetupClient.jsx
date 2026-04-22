"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

const USERNAME_RE = /^[a-zA-Z0-9_\-\.]{2,20}$/;

export default function SetupClient() {
  const { refreshUser } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!USERNAME_RE.test(trimmed)) {
      setError("2 à 20 caractères, lettres, chiffres, _ - .");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "erreur"); return; }
      await refreshUser();
      router.replace("/");
    } catch {
      setError("erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div>
          <span className="text-sm font-semibold tracking-tight">lyricus</span>
          <h1 className="text-2xl font-bold tracking-tight mt-4">choisis ton pseudo</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ce nom apparaîtra sur le classement. Tu pourras le changer plus tard.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(""); }}
            placeholder="ton_pseudo"
            maxLength={20}
            autoFocus
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            className="h-10 w-full border border-border bg-background px-3 text-sm font-mono outline-none focus:border-foreground transition-colors placeholder:text-muted-foreground"
          />

          {error && <p className="text-xs text-muted-foreground border border-border px-3 py-1.5">{error}</p>}

          <p className="text-[10px] text-muted-foreground">
            2–20 caractères · lettres, chiffres, <code>_</code> <code>-</code> <code>.</code>
          </p>

          <button
            type="submit"
            disabled={loading || name.trim().length < 2}
            className="h-10 border border-foreground bg-foreground text-background text-sm font-medium hover:bg-foreground/85 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {loading ? "..." : "valider →"}
          </button>
        </form>
      </div>
    </div>
  );
}
