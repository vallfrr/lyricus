import { Suspense } from "react";
import SettingsClient from "@/views/SettingsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "paramètres", robots: { index: false } };

export default function Page() {
  return (
    <Suspense>
      <SettingsClient />
    </Suspense>
  );
}
