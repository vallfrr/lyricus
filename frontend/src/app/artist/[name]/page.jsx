import { Suspense } from "react";
import ArtistClient from "@/views/ArtistClient";

export const dynamic = "force-dynamic";

export function generateMetadata({ params }) {
  return {
    title: `${decodeURIComponent(params.name)} · lyricus`,
    description: `Titres populaires de ${decodeURIComponent(params.name)} avec paroles sur lyricus`,
  };
}

export default function Page() {
  return (
    <Suspense>
      <ArtistClient />
    </Suspense>
  );
}
