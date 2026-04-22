import { Suspense } from "react";
import RegisterClient from "@/views/RegisterClient";

export const metadata = {
  title: "créer un compte",
};

export default function Page() {
  return <Suspense><RegisterClient /></Suspense>;
}
