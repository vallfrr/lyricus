import { Suspense } from "react";
import LoginClient from "@/views/LoginClient";

export const metadata = {
  title: "connexion",
};

export default function Page() {
  return <Suspense><LoginClient /></Suspense>;
}
