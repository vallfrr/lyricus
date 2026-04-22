import { Suspense } from "react";
import LeaderboardClient from "@/views/LeaderboardClient";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "classement — lyricus",
  description: "Les meilleurs joueurs de lyricus. Classement par score moyen.",
};

export default function Page() {
  return (
    <Suspense>
      <LeaderboardClient />
    </Suspense>
  );
}
