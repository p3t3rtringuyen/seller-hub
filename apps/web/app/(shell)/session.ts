"use client";
import type { ShellContextOptions, ShellContextValue } from "@seller-hub/ui";
import { useCallback, useState } from "react";
import { navEntries } from "../../nav.generated";

/**
 * Session and context seen by the shell. P3-IDENTITY implements `useShellSession` against `/v1/me` (tenant, seller
 * accounts, marketplaces, permissions) — the TYPE below is the contract it must keep; the BODY is a typed STUB.
 *
 * STUB behaviour (remove when P3-IDENTITY lands): permissions = those the registered nav entries ask for, one demo
 * tenant / seller account / marketplace, switching is local state.
 */
export interface ShellSession {
  /** While true every permission check is false and screens must wait before showing "no access" (UX-19). */
  loading: boolean;
  permissions: readonly string[];
  context: ShellContextValue;
  options: ShellContextOptions;
  /** True while a seller-account / marketplace switch is in flight (navbar actions disable, UX-18). */
  switching: boolean;
  switchContext: (next: ShellContextValue) => void;
}

const stubOptions: ShellContextOptions = {
  tenants: [{ id: "tenant-demo", label: "Demo tenant" }],
  sellerAccounts: [{ id: "seller-demo", label: "Demo seller account" }],
  marketplaces: [
    { id: "ATVPDKIKX0DER", label: "United States" },
    { id: "A2EUQ1WTGCTBG2", label: "Canada" },
  ],
};

const stubPermissions: readonly string[] = [...new Set(navEntries.map((e) => e.permission))];

export function useShellSession(): ShellSession {
  const [context, setContext] = useState<ShellContextValue>({
    tenantId: "tenant-demo",
    sellerAccountId: "seller-demo",
    marketplaceId: "ATVPDKIKX0DER",
  });
  const switchContext = useCallback((next: ShellContextValue) => setContext(next), []);
  return {
    loading: false,
    permissions: stubPermissions,
    context,
    options: stubOptions,
    switching: false,
    switchContext,
  };
}
