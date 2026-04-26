import { Suspense } from "react";
import GameClient from "@/views/GameClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "jeu",
  description: "Complétez les paroles manquantes de la chanson.",
  robots: { index: false },
};

export default function Page() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-sm text-muted-foreground">chargement...</div>}>
      <GameClient />
    </Suspense>
  );
}
