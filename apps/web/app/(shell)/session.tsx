"use client";
import type { ShellContextOptions, ShellContextValue } from "@seller-hub/ui";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError, get, post, type Schemas } from "@/lib/api-client";

/**
 * Session and context seen by the shell, backed by `/v1/me` (P3-IDENTITY): the signed-in user, the active tenant, the
 * seller accounts the caller may see with their permissions, and the marketplaces of the selected account.
 * `ShellSessionProvider` loads it once for the whole authenticated tree; `useShellSession()` reads it. A 401 sends the
 * browser to /sign-in. The TYPE below is the contract the shell (P3-DS) relies on.
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
  // --- added by P3-IDENTITY ---
  me: Schemas["PlatformTenancyMe"] | null;
  /** Permissions for the selected seller account (union of its grants); falls back to tenant-level ones. */
  sellerPermissions: readonly string[];
  marketplaces: readonly Schemas["PlatformTenancyAccountMarketplace"][];
  error: ApiError | null;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
}

const EMPTY_OPTIONS: ShellContextOptions = { tenants: [], sellerAccounts: [], marketplaces: [] };
const Ctx = createContext<ShellSession | null>(null);
const STORAGE_KEY = "sh.context";

function remembered(): Partial<ShellContextValue> {
  try {
    return JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "{}",
    ) as Partial<ShellContextValue>;
  } catch {
    return {};
  }
}
function remember(v: ShellContextValue): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    /* private mode: the selection just does not persist */
  }
}

export function ShellSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Schemas["PlatformTenancyMe"] | null>(null);
  const [marketplaces, setMarketplaces] = useState<Schemas["PlatformTenancyAccountMarketplace"][]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [context, setContext] = useState<ShellContextValue>({
    tenantId: "",
    sellerAccountId: "",
    marketplaceId: "",
  });

  const load = useCallback(async () => {
    try {
      const data = await get<Schemas["PlatformTenancyMe"]>("/v1/me");
      setMe(data);
      setError(null);
      const saved = remembered();
      const accountId =
        data.sellerAccounts.find((a) => a.id === saved.sellerAccountId)?.id ??
        data.sellerAccounts[0]?.id ??
        "";
      setContext((c) => ({
        tenantId: data.tenant.id,
        sellerAccountId: c.sellerAccountId || accountId,
        marketplaceId: c.marketplaceId,
      }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace("/sign-in");
        return;
      }
      setError(e instanceof ApiError ? e : new ApiError(0, "error", "Could not load your session"));
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  // marketplaces of the selected seller account
  useEffect(() => {
    if (!context.sellerAccountId) {
      setMarketplaces([]);
      return;
    }
    let cancelled = false;
    get<{ items: Schemas["PlatformTenancyAccountMarketplace"][] }>(
      `/v1/seller-accounts/${context.sellerAccountId}/marketplaces`,
    )
      .then((r) => {
        if (cancelled) return;
        setMarketplaces(r.items);
        setContext((c) =>
          r.items.some((m) => m.marketplaceId === c.marketplaceId)
            ? c
            : { ...c, marketplaceId: r.items[0]?.marketplaceId ?? "" },
        );
      })
      .catch(() => !cancelled && setMarketplaces([]));
    return () => {
      cancelled = true;
    };
  }, [context.sellerAccountId]);

  const switchContext = useCallback(
    (next: ShellContextValue) => {
      if (me && next.tenantId !== me.tenant.id) {
        setSwitching(true);
        post("/v1/auth/switch-tenant", { tenantId: next.tenantId })
          .then(() => window.location.assign("/settings/connections"))
          .catch(() => setSwitching(false));
        return;
      }
      setContext(next);
      remember(next);
    },
    [me],
  );

  const signOut = useCallback(async () => {
    try {
      await post("/v1/auth/sign-out");
    } finally {
      window.location.assign("/sign-in");
    }
  }, []);

  const value = useMemo<ShellSession>(() => {
    const account = me?.sellerAccounts.find((a) => a.id === context.sellerAccountId);
    return {
      loading,
      permissions: me?.permissions ?? [],
      sellerPermissions: account?.permissions ?? me?.permissions ?? [],
      context,
      options: me
        ? {
            tenants: me.tenants.map((t) => ({ id: t.id, label: t.name })),
            sellerAccounts: me.sellerAccounts.map((a) => ({ id: a.id, label: a.name })),
            marketplaces: marketplaces.map((m) => ({ id: m.marketplaceId, label: m.name })),
          }
        : EMPTY_OPTIONS,
      switching,
      switchContext,
      me,
      marketplaces,
      error,
      reload: load,
      signOut,
    };
  }, [me, marketplaces, loading, switching, context, error, switchContext, load, signOut]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShellSession(): ShellSession {
  const value = useContext(Ctx);
  if (!value)
    throw new Error(
      "useShellSession must be used inside <ShellSessionProvider> (the (app) layout)",
    );
  return value;
}
