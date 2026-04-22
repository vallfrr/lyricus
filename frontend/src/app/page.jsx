import { Suspense } from "react";
import HomeClient from "@/views/HomeClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "lyricus — complète les paroles",
  description: "Testez vos connaissances sur les paroles de vos chansons préférées. Choisissez une chanson, sélectionnez la difficulté et complétez les paroles manquantes.",
};

export default function Page() {
  return <Suspense><HomeClient /></Suspense>;
}
