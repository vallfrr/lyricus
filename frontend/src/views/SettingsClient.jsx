"use client";
import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import { useTheme, THEMES } from "@/hooks/useTheme";
import { useI18n } from "@/contexts/I18nContext";
import { useAuth } from "@/contexts/AuthContext";
import { LOCALES, LOCALE_META } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { GoogleSvg, DiscordSvg, AppleSvg, FacebookSvg } from "@/components/OAuthButtons";

function SpotifySvg({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#1DB954">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
    </svg>
  );
}

function DeezerSvg({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#A238FF">
      <path d="M18.944 17.773H24v2.25h-5.056zm0-4.217H24v2.25h-5.056zm0-4.218H24V11.6h-5.056zM0 17.773h5.056v2.25H0zm6.322 0h5.056v2.25H6.322zm6.322 0H17.7v2.25h-5.056zM6.322 13.556h5.056v2.25H6.322zm6.322 0H17.7v2.25h-5.056zm6.3 0H24v2.25h-5.056zM12.644 9.338H17.7v2.25h-5.056z"/>
    </svg>
  );
}

function Toggle({ value, onChange }) {
  return (
    <button
      onClick={onChange}
      role="switch"
      aria-checked={value}
      className={cn(
        "relative inline-flex items-center shrink-0 w-11 h-6 border transition-colors",
        value ? "border-foreground bg-foreground/10" : "border-border bg-transparent"
      )}
    >
      <span
        className={cn(
          "absolute top-1 w-4 h-4 transition-all duration-150",
          value ? "left-[calc(100%-1.25rem)] bg-foreground" : "left-1 bg-border"
        )}
      />
    </button>
  );
}


const USERNAME_RE = /^[a-zA-Z0-9_\-\.]{2,20}$/;

export default function SettingsClient() {
  const { theme, setTheme } = useTheme();
  const { t, locale, setLocale } = useI18n();
  const { user, refreshUser, logout } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [langOpen, setLangOpen] = useState(false);
  const [publicHistory, setPublicHistory] = useState(true);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [nameSuccess, setNameSuccess] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);

  // Link feedback from OAuth redirect
  const linkSuccess = searchParams.get("link_success");
  const linkError = searchParams.get("link_error");

  const [playlists, setPlaylists] = useState([]);
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [addingPlaylist, setAddingPlaylist] = useState(false);
  const [playlistError, setPlaylistError] = useState("");

  useEffect(() => {
    if (user) {
      fetch("/api/playlists", { credentials: "include" })
        .then(r => r.ok ? r.json() : [])
        .then(data => setPlaylists(data))
        .catch(() => {});
    }
  }, [user]);

  async function handleAddPlaylist(e) {
    e.preventDefault();
    if (!playlistUrl.trim() || playlists.length >= 5) return;
    setAddingPlaylist(true);
    setPlaylistError("");
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ url: playlistUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPlaylistError(data.error || "erreur d'ajout");
      } else {
        setPlaylists(prev => [data, ...prev]);
        setPlaylistUrl("");
      }
    } catch {
      setPlaylistError("erreur réseau");
    } finally {
      setAddingPlaylist(false);
    }
  }

  async function handleRemovePlaylist(id) {
    try {
      await fetch(`/api/playlists/${id}`, { method: "DELETE", credentials: "include" });
      setPlaylists(prev => prev.filter(p => p.id !== id));
    } catch {}
  }


  // Delete account flow: 0 = idle, 1 = first confirm, 2 = second confirm
  const [deleteStep, setDeleteStep] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (user) {
      setPublicHistory(user.public_history ?? true);
      setName(user.name || "");
    }
  }, [user]);

  useEffect(() => {
    if (!nameSuccess) return;
    const id = setTimeout(() => setNameSuccess(false), 3000);
    return () => clearTimeout(id);
  }, [nameSuccess]);

  async function togglePublicHistory() {
    const newVal = !publicHistory;
    setPublicHistory(newVal);
    await fetch("/api/auth/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ public_history: newVal }),
    }).catch(() => setPublicHistory(!newVal));
  }

  async function handleNameSubmit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!USERNAME_RE.test(trimmed)) { setNameError("2–20 caractères, lettres, chiffres, _ - ."); return; }
    setNameSaving(true);
    setNameError("");
    setNameSuccess(false);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) { setNameError(data.error || "erreur"); return; }
      await refreshUser();
      setNameSuccess(true);
    } catch {
      setNameError("erreur réseau");
    } finally {
      setNameSaving(false);
    }
  }



  async function handleDeleteAccount() {
    setDeleting(true);
    try {
      await fetch("/api/auth/me", { method: "DELETE", credentials: "include" });
      await logout();
      router.push("/");
    } catch {
      setDeleting(false);
      setDeleteStep(0);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />

      <main className="flex-1 max-w-xl mx-auto w-full px-4 py-10 flex flex-col gap-10">
        <h1 className="text-xl font-semibold tracking-tight">{t("settings.title")}</h1>

        {/* Playlists (Top level for logged-in users) */}
        {user && (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest">playlists ({playlists.length}/5)</span>
            </div>
            <form onSubmit={handleAddPlaylist} className="flex gap-2">
              <Input
                type="url"
                placeholder="Lien Spotify ou Deezer"
                value={playlistUrl}
                onChange={(e) => { setPlaylistUrl(e.target.value); setPlaylistError(""); }}
                disabled={playlists.length >= 5 || addingPlaylist}
                className="flex-1" 
              />
              <button
                type="submit"
                disabled={playlists.length >= 5 || !playlistUrl.trim() || addingPlaylist}
                className="h-9 px-4 border border-foreground bg-foreground text-background text-xs hover:bg-foreground/85 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
              >
                {addingPlaylist ? "..." : "ajouter"}
              </button>
            </form>
            {playlistError && <p className="text-[11px] text-muted-foreground">{playlistError}</p>}

            <div className="flex flex-col gap-2 mt-2">
              {playlists.map((pl) => (
                <div key={pl.id} className="flex items-center gap-3 border border-border p-2">
                  {pl.cover ? (
                    <img src={pl.cover} alt={pl.name} className="w-10 h-10 object-cover bg-secondary border border-border shrink-0" />
                  ) : (
                    <div className="w-10 h-10 border border-border bg-secondary shrink-0" />
                  )}
                  <div className="flex flex-col min-w-0 flex-1">
                    <a href={pl.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-foreground truncate hover:underline">
                      {pl.name}
                    </a>
                    <span className="text-[10px] text-muted-foreground">
                      {pl.track_count} titres • {pl.platform}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRemovePlaylist(pl.id)}
                    className="text-[10px] border border-border px-2 py-1 text-muted-foreground hover:border-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Language */}
        <section className="flex flex-col gap-3">
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{t("settings.language")}</span>
          <div className="relative">
            <button
              onClick={() => setLangOpen((o) => !o)}
              className="w-full flex items-center justify-between border border-border px-4 py-2.5 text-sm hover:border-foreground transition-colors"
            >
              <span className="flex items-center gap-2">
                <span>{LOCALE_META[locale]?.flag}</span>
                <span>{LOCALE_META[locale]?.label}</span>
              </span>
              <span className="text-muted-foreground text-xs">{langOpen ? "▲" : "▼"}</span>
            </button>
            {langOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setLangOpen(false)} />
                <div className="absolute left-0 right-0 top-full z-50 bg-background border border-border border-t-0 shadow-md">
                  {LOCALES.map((l) => (
                    <button
                      key={l}
                      onClick={() => { setLocale(l); setLangOpen(false); }}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-2.5 text-sm border-b border-border last:border-b-0 transition-colors hover:bg-accent",
                        l === locale ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      <span>{LOCALE_META[l].flag}</span>
                      <span>{LOCALE_META[l].label}</span>
                      {l === locale && <span className="ml-auto text-xs">✓</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>

        {/* Theme */}
        <section className="flex flex-col gap-4">
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{t("settings.theme")}</span>

          {[
            { label: "dark", themes: THEMES.filter((th) => th.dark) },
            { label: "light", themes: THEMES.filter((th) => !th.dark) },
          ].map((group) => (
            <div key={group.label} className="flex flex-col gap-2">
              <span className="text-[10px] text-muted-foreground/60 uppercase tracking-widest">{group.label}</span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {group.themes.map((th) => (
                  <button
                    key={th.id}
                    onClick={() => setTheme(th.id)}
                    className={cn(
                      "flex flex-col gap-2 p-3 border text-left transition-colors",
                      theme === th.id ? "border-foreground" : "border-border hover:border-foreground/50"
                    )}
                  >
                    <div
                      className="w-full h-7 border border-black/10 flex items-center gap-1.5 px-2"
                      style={{ background: th.bg }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: th.fg }} />
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: th.accent }} />
                      <span className="flex-1 h-px" style={{ background: th.fg + "33" }} />
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] truncate">{th.label}</span>
                      {theme === th.id && <span className="text-[10px] text-muted-foreground shrink-0">✓</span>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>

        {/* Confidentialité & compte (logged-in only) */}
        {user && (
          <section className="flex flex-col gap-4">
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest">confidentialité</span>

            {/* Email (info) */}
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">adresse email</span>
              <span className="text-sm font-mono text-foreground/80">{user.email}</span>
            </div>

            {/* Username */}
            <form onSubmit={handleNameSubmit} className="flex flex-col gap-2">
              <span className="text-xs text-muted-foreground">pseudo</span>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={name}
                  onChange={(e) => { setName(e.target.value); setNameError(""); setNameSuccess(false); }}
                  maxLength={20}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  className="flex-1"
                />
                <button
                  type="submit"
                  disabled={nameSaving || name.trim().length < 2 || name.trim() === user.name}
                  className="h-9 px-4 border border-foreground bg-foreground text-background text-xs hover:bg-foreground/85 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                >
                  {nameSaving ? "..." : nameSuccess ? "✓" : "enregistrer"}
                </button>
              </div>
              {nameError && <p className="text-[11px] text-muted-foreground">{nameError}</p>}
              <p className="text-[10px] text-muted-foreground">2–20 caractères · lettres, chiffres, _ - .</p>
            </form>

            {/* Public history toggle */}
            <div className="flex items-center justify-between border border-border px-4 py-3 gap-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm">historique public</span>
                <span className="text-xs text-muted-foreground">permettre aux autres de voir tes parties récentes sur ton profil</span>
              </div>
              <Toggle value={publicHistory} onChange={togglePublicHistory} />
            </div>

            {/* Connected providers */}
            <div className="flex flex-col gap-3">
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest">connexions</span>

              {/* Link feedback */}
              {linkSuccess && (
                <p className="text-xs border border-border px-3 py-2">
                  ✓ compte {linkSuccess === "google" ? "Google" : linkSuccess === "discord" ? "Discord" : linkSuccess} lié avec succès
                </p>
              )}
              {linkError === "already_used" && (
                <p className="text-xs border border-border px-3 py-2 text-muted-foreground">
                  ce compte Google est déjà associé à un autre utilisateur
                </p>
              )}

              {/* Email/password provider */}
              <div className="flex items-center justify-between border border-border px-4 py-3 gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm">email / mot de passe</span>
                </div>
                {user.providers?.email ? (
                  <span className="text-[10px] text-muted-foreground">connecté ✓</span>
                ) : (
                  <a
                    href="/register"
                    className="text-xs border border-border px-3 py-1 hover:border-foreground transition-colors"
                  >
                    configurer
                  </a>
                )}
              </div>

              {/* Active auth providers */}
              {[
                { key: "google",  label: "Google",  icon: <GoogleSvg size={14} />,  href: "/api/auth/google?link=1" },
                { key: "discord", label: "Discord", icon: <DiscordSvg size={14} />, href: "/api/auth/discord?link=1" },
              ].map(({ key, label, icon, href }) => (
                <div key={key} className="flex items-center justify-between border border-border px-4 py-3 gap-4">
                  <div className="flex items-center gap-2">{icon}<span className="text-sm">{label}</span></div>
                  {user.providers?.[key] ? (
                    <span className="text-[10px] text-muted-foreground">connecté ✓</span>
                  ) : (
                    <a href={href} className="text-xs border border-border px-3 py-1 hover:border-foreground transition-colors">lier</a>
                  )}
                </div>
              ))}

              {/* Coming soon auth providers */}
              {[
                { label: "Apple",    icon: <AppleSvg size={14} /> },
                { label: "Facebook", icon: <FacebookSvg size={14} /> },
              ].map(({ label, icon }) => (
                <div key={label} className="flex items-center justify-between border border-border border-dashed px-4 py-3 gap-4 opacity-40">
                  <div className="flex items-center gap-2">{icon}<span className="text-sm">{label}</span></div>
                  <span className="text-[10px] text-muted-foreground">bientôt</span>
                </div>
              ))}
            </div>


            {/* Delete account */}
            <div className="flex flex-col gap-3 mt-2">
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest">zone de danger</span>

              {deleteStep === 0 && (
                <button
                  onClick={() => setDeleteStep(1)}
                  className="h-9 border border-border text-xs text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
                >
                  supprimer mon compte
                </button>
              )}

              {deleteStep === 1 && (
                <div className="border border-border p-4 flex flex-col gap-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">supprimer ton compte ?</span>
                    <span className="text-xs text-muted-foreground">
                      toutes tes données seront définitivement effacées : profil, historique, scores. cette action est irréversible.
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setDeleteStep(0)}
                      className="flex-1 h-9 border border-border text-xs text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
                    >
                      annuler
                    </button>
                    <button
                      onClick={() => setDeleteStep(2)}
                      className="flex-1 h-9 border border-border text-xs hover:border-foreground transition-colors"
                    >
                      continuer
                    </button>
                  </div>
                </div>
              )}

              {deleteStep === 2 && (
                <div className="border border-border p-4 flex flex-col gap-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">dernière confirmation</span>
                    <span className="text-xs text-muted-foreground">
                      es-tu absolument sûr ? il n'y a aucun retour en arrière possible.
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setDeleteStep(0)}
                      className="flex-1 h-9 border border-border text-xs text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
                    >
                      annuler
                    </button>
                    <button
                      onClick={handleDeleteAccount}
                      disabled={deleting}
                      className="flex-1 h-9 border border-border text-xs text-muted-foreground hover:border-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {deleting ? "..." : "supprimer définitivement"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </main>

      <Footer />
    </div>
  );
}
