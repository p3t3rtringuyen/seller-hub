import { HelloCard } from "@/features/example/hello/public";
import { messagesByLocale } from "@/messages.generated";
import { navEntries } from "@/nav.generated";
import { slotsFor } from "@/slots.generated";
import type { ComponentType } from "react";

// EXAMPLE page (delete with modules/example): reads copy from the generated message catalogue, renders the
// registered slot and shows the nav entries the generator found.
export default function ExamplePage() {
  const t = messagesByLocale.en?.["example.hello"] ?? {};
  return (
    <div>
      <HelloCard title={String(t.title ?? "")} state="ready">
        <ul data-testid="nav-entries">
          {navEntries.map((n) => (
            <li key={n.id}>{n.href}</li>
          ))}
        </ul>
        {slotsFor("example.hello.extras").map((s, i) => {
          const Component = s.component as ComponentType;
          return <Component key={i} />;
        })}
      </HelloCard>
    </div>
  );
}
