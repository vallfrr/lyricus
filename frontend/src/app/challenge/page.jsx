import { Suspense } from "react";
import ChallengeClient from "@/views/ChallengeClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Défi · lyricus" };

export default function Page() {
  return <Suspense><ChallengeClient /></Suspense>;
}
