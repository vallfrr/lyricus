import { Suspense } from "react";
import SetupClient from "@/views/SetupClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "choisis ton pseudo", robots: { index: false } };

export default function Page() {
  return <Suspense><SetupClient /></Suspense>;
}
