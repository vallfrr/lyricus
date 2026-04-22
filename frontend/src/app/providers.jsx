"use client";
import { AuthProvider } from "@/contexts/AuthContext";
import { I18nProvider } from "@/contexts/I18nContext";
import { AudioProvider } from "@/contexts/AudioContext";

export default function Providers({ children }) {
  return (
    <I18nProvider>
      <AuthProvider>
        <AudioProvider>{children}</AudioProvider>
      </AuthProvider>
    </I18nProvider>
  );
}
