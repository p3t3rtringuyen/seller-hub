"use client";
import type { ComponentType } from "react";
import { slotsFor } from "../../slots.generated";

/**
 * Renders every component registered for a named slot (`*.slot.tsx` files, BACKLOG §1.2), in `order`.
 * The shell declares: `shell.header.actions` (right side of the header) and `shell.sidebar.footer`.
 */
export function SlotOutlet({ name }: { name: string }) {
  const registrations = slotsFor(name);
  if (registrations.length === 0) return null;
  return (
    <>
      {registrations.map((r, i) => {
        const Component = r.component as ComponentType;
        return <Component key={`${name}-${i}`} />;
      })}
    </>
  );
}
