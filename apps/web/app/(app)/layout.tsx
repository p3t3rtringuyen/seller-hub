import type { ReactNode } from "react";
import { AppFrame } from "../(shell)/AppFrame";

// Every authenticated page renders inside the app shell (nav + slots from the generated registries).
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}
