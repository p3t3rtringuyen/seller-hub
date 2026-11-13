"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";

// D55 / UX-19: the UI hides write controls without permission and shows them locked, with a reason, when the
// permission exists but the entity forbids the action. The API stays the enforcer. While roles load, every check
// is false, and screens must wait (`loading`) before showing "no access".

export interface PermissionState {
  loading: boolean;
  permissions: ReadonlySet<string>;
}

const PermissionContext = createContext<PermissionState>({ loading: true, permissions: new Set() });

export function PermissionProvider({
  permissions,
  loading = false,
  children,
}: {
  permissions: Iterable<string>;
  loading?: boolean;
  children: ReactNode;
}) {
  const value = useMemo<PermissionState>(
    () => ({ loading, permissions: new Set(loading ? [] : permissions) }),
    [loading, permissions],
  );
  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermissions(): PermissionState {
  return useContext(PermissionContext);
}

/** True only when roles have loaded and include `permission`. */
export function useCan(permission: string): boolean {
  const { loading, permissions } = usePermissions();
  return !loading && permissions.has(permission);
}

export interface PermissionGateProps {
  permission: string;
  /** `hide` (default): render nothing without permission. `lock`: render `fallback` instead. */
  mode?: "hide" | "lock";
  fallback?: ReactNode;
  children: ReactNode;
}

/** While roles load nothing renders (never a flash of "no access"). */
export function PermissionGate({
  permission,
  mode = "hide",
  fallback = null,
  children,
}: PermissionGateProps) {
  const { loading } = usePermissions();
  const can = useCan(permission);
  if (loading) return null;
  if (can) return <>{children}</>;
  return mode === "lock" ? <>{fallback}</> : null;
}
