"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import { cn } from "@/lib/utils";
import { OAuthButton, GoogleSvg, DiscordSvg, AppleSvg, FacebookSvg } from "@/components/OAuthButtons";

const RULES = [
  { label: "8 caractères minimum", check: (p) => p.length >= 8 },
  { label: "une majuscule",         check: (p) => /[A-Z]/.test(p) },
  { label: "une minuscule",         check: (p) => /[a-z]/.test(p) },
  { label: "un chiffre",            check: (p) => /\d/.test(p) },
];

function EyeIcon({ open }) {
  return open ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

export default function RegisterClient() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pwFocused, setPwFocused] = useState(false);

  const allRulesMet = RULES.every((r) => r.check(password));
  const confirmOk   = confirm.length > 0 && password === confirm;
  const canSubmit   = email && allRulesMet && confirmOk;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!allRulesMet) { setError("le mot de passe ne respecte pas les critères"); return; }
    if (password !== confirm) { setError("les mots de passe ne correspondent pas"); return; }

    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "erreur"); return; }
      router.push("/setup");
    } catch {
      setError("erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />

      <main className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm flex flex-col gap-6">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">créer un compte</h1>
            <p className="text-xs text-muted-foreground mt-1">rejoins lyricus et sauvegarde tes scores</p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="email"
              placeholder="adresse email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }}
              required
              autoComplete="email"
              className="h-9 w-full border border-border bg-background px-3 text-sm font-mono outline-none focus:border-foreground transition-colors placeholder:text-muted-foreground"
            />

            <div className="flex flex-col gap-1">
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  placeholder="mot de passe"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(""); }}
                  onFocus={() => setPwFocused(true)}
                  onBlur={() => setPwFocused(false)}
                  required
                  autoComplete="new-password"
                  className="h-9 w-full border border-border bg-background px-3 pr-9 text-sm font-mono outline-none focus:border-foreground transition-colors placeholder:text-muted-foreground"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-0 top-0 h-9 w-9 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  <EyeIcon open={showPw} />
                </button>
              </div>
              {(pwFocused || password.length > 0) && (
                <div className="flex flex-col gap-0.5 px-1 pt-1">
                  {RULES.map((r) => (
                    <span
                      key={r.label}
                      className={cn(
                        "text-[10px] transition-colors",
                        r.check(password) ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      {r.check(password) ? "✓" : "·"} {r.label}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <div className="relative">
                <input
                  type={showConfirm ? "text" : "password"}
                  placeholder="confirmer le mot de passe"
                  value={confirm}
                  onChange={(e) => { setConfirm(e.target.value); setError(""); }}
                  required
                  autoComplete="new-password"
                  className={cn(
                    "h-9 w-full border bg-background px-3 pr-9 text-sm font-mono outline-none transition-colors placeholder:text-muted-foreground",
                    confirm.length > 0
                      ? confirmOk ? "border-foreground" : "border-border"
                      : "border-border focus:border-foreground"
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className="absolute right-0 top-0 h-9 w-9 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  <EyeIcon open={showConfirm} />
                </button>
              </div>
              {confirm.length > 0 && !confirmOk && (
                <span className="text-[10px] text-muted-foreground px-1">les mots de passe ne correspondent pas</span>
              )}
            </div>

            {error && (
              <p className="text-xs text-muted-foreground border border-border px-3 py-1.5">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !canSubmit}
              className="h-9 border border-foreground bg-foreground text-background text-sm font-medium hover:bg-foreground/85 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {loading ? "..." : "créer mon compte"}
            </button>
          </form>

          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <div className="flex-1 border-t border-border" />
            ou
            <div className="flex-1 border-t border-border" />
          </div>

          <div className="flex flex-col gap-2">
            <OAuthButton href="/api/auth/google"  label="continuer avec Google"   icon={<GoogleSvg />} />
            <OAuthButton href="/api/auth/discord" label="continuer avec Discord"  icon={<DiscordSvg />} />
            <OAuthButton disabled label="continuer avec Apple"    icon={<AppleSvg />} />
            <OAuthButton disabled label="continuer avec Facebook" icon={<FacebookSvg />} />
          </div>

          <p className="text-xs text-muted-foreground text-center">
            déjà un compte ?{" "}
            <Link href="/login" className="text-foreground hover:underline">
              se connecter
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
