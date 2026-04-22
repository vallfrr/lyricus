import { Suspense } from "react";
import UserProfileClient from "@/views/UserProfileClient";

export const dynamic = "force-dynamic";

export function generateMetadata({ params }) {
  return {
    title: params.username,
    description: `Profil de ${params.username} sur lyricus`,
  };
}

export default function Page() {
  return (
    <Suspense>
      <UserProfileClient />
    </Suspense>
  );
}
