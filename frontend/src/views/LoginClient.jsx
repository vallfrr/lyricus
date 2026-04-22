"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import { OAuthButton, GoogleSvg, DiscordSvg, AppleSvg, FacebookSvg } from "@/components/OAuthButtons";

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

const AUTH_ERRORS = {
  email_taken: "cette adresse email est déjà associée à un autre compte. connecte-toi puis lie Discord dans les paramètres.",
};

export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const authError = AUTH_ERRORS[searchParams.get("auth_error")] || null;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "erreur"); return; }
      router.push(data.needs_setup ? "/setup" : "/");
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
            <h1 className="text-xl font-semibold tracking-tight">connexion</h1>
            <p className="text-xs text-muted-foreground mt-1">connecte-toi pour sauvegarder tes scores</p>
          </div>

          {authError && (
            <p className="text-xs text-muted-foreground border border-border px-3 py-2">{authError}</p>
          )}

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
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                placeholder="mot de passe"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                required
                autoComplete="current-password"
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

            {error && (
              <p className="text-xs text-muted-foreground border border-border px-3 py-1.5">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="h-9 border border-foreground bg-foreground text-background text-sm font-medium hover:bg-foreground/85 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {loading ? "..." : "se connecter"}
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
            pas encore de compte ?{" "}
            <Link href="/register" className="text-foreground hover:underline">
              créer un compte
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
