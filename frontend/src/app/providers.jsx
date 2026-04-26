"use client";
import { useEffect } from "react";
import { AuthProvider } from "@/contexts/AuthContext";
import { I18nProvider } from "@/contexts/I18nContext";
import { AudioProvider } from "@/contexts/AudioContext";
import { useAuth } from "@/contexts/AuthContext";
import { useAudio } from "@/contexts/AudioContext";

/** Syncs the user's saved preview_volume from the DB into the AudioContext once on login. */
function VolumeSync() {
  const { user } = useAuth();
  const { initVolumeFromUser } = useAudio();

  useEffect(() => {
    if (user && typeof user.preview_volume === "number") {
      initVolumeFromUser(user.preview_volume);
    }
  }, [user?.id]); // re-run only when the logged-in user changes

  return null;
}

export default function Providers({ children }) {
  return (
    <I18nProvider>
      <AuthProvider>
        <AudioProvider>
          <VolumeSync />
          {children}
        </AudioProvider>
      </AuthProvider>
    </I18nProvider>
  );
}
