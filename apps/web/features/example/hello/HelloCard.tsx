import type { ReactNode } from "react";

// EXAMPLE component (delete with modules/example). Copy comes from the message catalogue, never inline.
export interface HelloCardProps {
  title: string;
  state: "loading" | "empty" | "ready";
  children?: ReactNode;
}

export function HelloCard({ title, state, children }: HelloCardProps) {
  return (
    <section aria-label={title} data-state={state}>
      <h2>{title}</h2>
      {state === "loading" ? <p role="status">Loading…</p> : null}
      {state === "empty" ? <p>Nothing here yet.</p> : null}
      {state === "ready" ? children : null}
    </section>
  );
}
