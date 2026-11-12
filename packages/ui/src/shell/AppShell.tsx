"use client";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon, MenuIcon } from "../icons";
import { useMessages } from "../messages";

export interface ShellNavItem {
  id: string;
  label: string;
  href: string;
}
export interface ShellNavSection {
  id: string;
  label: string;
  items: readonly ShellNavItem[];
}
export interface Crumb {
  label: string;
  /** Last crumb has no href. */
  href?: string;
}

export interface AppShellProps {
  /** Already filtered by permission and translated (the registry reader does that). */
  sections: readonly ShellNavSection[];
  /** For the active item and to close the sidebar on narrow screens when the route changes. */
  currentPath: string;
  /** Router link injected by the app so this package does not depend on next. */
  renderLink?: (item: {
    href: string;
    children: ReactNode;
    className?: string;
    ariaCurrent?: "page";
  }) => ReactNode;
  /** Tenant / seller account / marketplace switcher. */
  switcher?: ReactNode;
  /** Header right side: theme toggle, user menu, slot output. */
  headerActions?: ReactNode;
  sidebarFooter?: ReactNode;
  breadcrumbs?: readonly Crumb[];
  /** Page title per route. */
  title?: string;
  brand?: string;
  children: ReactNode;
}

const defaultLink: NonNullable<AppShellProps["renderLink"]> = ({ href, children, ariaCurrent }) => (
  <a
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
    {children}
  </a>
);

const COLLAPSED = 56;
const EXPANDED = 232;

/** Sidebar (collapsed by default, UX-25), header with switcher, breadcrumbs and page title. */
export function AppShell({
  sections,
  currentPath,
  renderLink = defaultLink,
  switcher,
  headerActions,
  sidebarFooter,
  breadcrumbs,
  title,
  brand = "seller-hub",
  children,
}: AppShellProps) {
  const t = useMessages();
  const [expanded, setExpanded] = useState(false);
  // Narrow screens: the menu closes on route change.
  useEffect(() => setExpanded(false), [currentPath]);

  const isActive = (href: string) =>
    currentPath === href || (href !== "/" && currentPath.startsWith(`${href}/`));

  return (
    <Box
      sx={{
        display: "flex",
        minHeight: "100vh",
        bgcolor: "background.default",
        color: "text.primary",
      }}
    >
      <Link
        href="#main-content"
        sx={{
          position: "absolute",
          left: -9999,
          "&:focus": { left: 8, top: 8, zIndex: 2000, bgcolor: "background.paper", p: 1 },
        }}
      >
        {t("shell.skipToContent")}
      </Link>
      <Box
        component="nav"
        aria-label={t("shell.mainNavigation")}
        data-testid="sidebar"
        data-expanded={expanded}
        sx={{
          width: expanded ? EXPANDED : COLLAPSED,
          flex: "none",
          borderRight: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
          display: "flex",
          flexDirection: "column",
          transition: "width 120ms",
          overflow: "hidden",
          position: "sticky",
          top: 0,
          height: "100vh",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", height: 56, px: 1, gap: 1 }}>
          <IconButton
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? t("shell.collapseMenu") : t("shell.expandMenu")}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronLeftIcon /> : <MenuIcon />}
          </IconButton>
          {expanded ? (
            <Typography noWrap sx={{ fontWeight: 700 }}>
              {brand}
            </Typography>
          ) : null}
        </Box>
        <Box sx={{ flex: 1, overflowY: "auto", overflowX: "hidden", py: 1 }}>
          {sections.map((section) => (
            <Box key={section.id} component="section" aria-label={section.label} sx={{ mb: 1 }}>
              {expanded ? (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ px: 2, textTransform: "uppercase", letterSpacing: 0.5 }}
                >
                  {section.label}
                </Typography>
              ) : null}
              <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
                {section.items.map((item) => {
                  const active = isActive(item.href);
                  const content = (
                    <>
                      <Box
                        aria-hidden="true"
                        sx={{
                          width: 28,
                          height: 28,
                          flex: "none",
                          borderRadius: 1,
                          display: "grid",
                          placeItems: "center",
                          fontWeight: 700,
                          bgcolor: active ? "primary.main" : "action.hover",
                          color: active ? "primary.contrastText" : "text.secondary",
                        }}
                      >
                        {item.label.slice(0, 1).toUpperCase()}
                      </Box>
                      {expanded ? (
                        <Typography noWrap sx={{ fontWeight: active ? 700 : 500 }}>
                          {item.label}
                        </Typography>
                      ) : (
                        <Box
                          component="span"
                          data-visually-hidden
                          sx={{
                            position: "absolute",
                            width: 1,
                            height: 1,
                            overflow: "hidden",
                            clip: "rect(0 0 0 0)",
                          }}
                        >
                          {item.label}
                        </Box>
                      )}
                    </>
                  );
                  const link = renderLink({
                    href: item.href,
                    children: content,
                    ...(active ? { ariaCurrent: "page" as const } : {}),
                  });
                  return (
                    <li key={item.id} data-nav-id={item.id} style={{ padding: "2px 12px" }}>
                      {expanded ? (
                        link
                      ) : (
                        <Tooltip title={item.label} placement="right">
                          {<span style={{ display: "block" }}>{link}</span>}
                        </Tooltip>
                      )}
                    </li>
                  );
                })}
              </Box>
            </Box>
          ))}
        </Box>
        {sidebarFooter ? <Box sx={{ p: 1 }}>{sidebarFooter}</Box> : null}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <Box
          component="header"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            minHeight: 56,
            px: 2,
            borderBottom: 1,
            borderColor: "divider",
            bgcolor: "background.paper",
            flexWrap: "wrap",
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>{switcher}</Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>{headerActions}</Box>
        </Box>
        <Box
          component="main"
          id="main-content"
          tabIndex={-1}
          sx={{ flex: 1, minWidth: 0, p: 2, outline: "none" }}
        >
          {breadcrumbs && breadcrumbs.length > 0 ? (
            <Box component="nav" aria-label={t("shell.breadcrumbs")} sx={{ mb: 0.5 }}>
              <Box
                component="ol"
                sx={{
                  listStyle: "none",
                  display: "flex",
                  gap: 0.75,
                  m: 0,
                  p: 0,
                  color: "text.secondary",
                }}
              >
                {breadcrumbs.map((c, i) => {
                  const last = i === breadcrumbs.length - 1;
                  return (
                    <Fragment key={`${c.label}-${i}`}>
                      <li aria-current={last ? "page" : undefined}>
                        {c.href && !last
                          ? renderLink({ href: c.href, children: c.label })
                          : c.label}
                      </li>
                      {last ? null : (
                        <li aria-hidden="true">
                          <ChevronRightIcon sx={{ fontSize: 14, verticalAlign: "middle" }} />
                        </li>
                      )}
                    </Fragment>
                  );
                })}
              </Box>
            </Box>
          ) : null}
          {title ? (
            <Typography variant="h1" component="h1" sx={{ mb: 2 }}>
              {title}
            </Typography>
          ) : null}
          {children}
        </Box>
      </Box>
    </Box>
  );
}
