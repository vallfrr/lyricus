"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

const AuthContext = createContext(null);

const SETUP_EXEMPT = ["/setup"];

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((d) => setUser(d.user))
      .catch(() => setUser(null));
  }, []);

  // After login: flush any pending game saved before the user was authenticated
  useEffect(() => {
    if (!user) return;
    try {
      const raw = localStorage.getItem("lyricusPendingGame");
      if (!raw) return;
      localStorage.removeItem("lyricusPendingGame");
      fetch("/api/history/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: raw,
      }).catch(() => {});
    } catch {}
  }, [user?.id]);

  // Redirect to /setup if username not set
  useEffect(() => {
    if (user?.needs_setup && !SETUP_EXEMPT.includes(pathname)) {
      router.replace("/setup");
    }
  }, [user, pathname]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
    router.push("/login");
  }

  async function refreshUser() {
    const d = await fetch("/api/auth/me", { credentials: "include" }).then((r) => r.json()).catch(() => ({ user: null }));
    setUser(d.user);
  }

  return (
    <AuthContext.Provider value={{ user, logout, refreshUser, loading: user === undefined }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
