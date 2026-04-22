import { Suspense } from "react";
import HistoryClient from "@/views/HistoryClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "historique — lyricus",
  description: "Vos parties passées sur lyricus.",
  robots: { index: false },
};

export default function Page() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-sm text-muted-foreground">chargement...</div>}>
      <HistoryClient />
    </Suspense>
  );
}
