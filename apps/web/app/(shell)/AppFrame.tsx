"use client";
import { AppShell, ContextSwitcher, PermissionProvider, ThemeToggle } from "@seller-hub/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import { navEntries } from "../../nav.generated";
import { buildBreadcrumbs } from "./breadcrumbs";
import { shellMessages } from "./messages";
import { buildNavSections } from "./nav";
import { useShellSession } from "./session";
import { SlotOutlet } from "./SlotOutlet";

/**
 * The authenticated frame: sidebar fed by the generated nav registry (filtered by permission), header with the
 * tenant / seller account / marketplace switcher, breadcrumbs and title per route, and the shell slots.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const session = useShellSession();

  const permissions = useMemo(() => new Set(session.loading ? [] : session.permissions), [session]);
  const sections = useMemo(
    () => buildNavSections(navEntries, (p) => permissions.has(p)),
    [permissions],
  );
  const known = useMemo(
    () => sections.flatMap((s) => s.items.map((i) => ({ href: i.href, label: i.label }))),
    [sections],
  );
  const { crumbs, title } = buildBreadcrumbs(pathname, known);

  return (
    <PermissionProvider permissions={session.permissions} loading={session.loading}>
      <AppShell
        brand={shellMessages.brand}
        sections={sections}
        currentPath={pathname}
        title={title}
        breadcrumbs={crumbs}
        renderLink={({ href, children: content, ariaCurrent }) => (
          <Link
            href={href}
            {...(ariaCurrent ? { "aria-current": ariaCurrent } : {})}
            style={{
              color: "inherit",
              textDecoration: "none",
              display: "flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
            }}
          >
            {content}
          </Link>
        )}
        switcher={
          <ContextSwitcher
            value={session.context}
            options={session.options}
            onChange={session.switchContext}
            switching={session.switching}
            showTenant={session.options.tenants.length > 1}
          />
        }
        headerActions={
          <>
            <SlotOutlet name="shell.header.actions" />
            <ThemeToggle />
          </>
        }
        sidebarFooter={<SlotOutlet name="shell.sidebar.footer" />}
      >
        {children}
      </AppShell>
    </PermissionProvider>
  );
}
