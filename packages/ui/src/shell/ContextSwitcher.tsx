"use client";
import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { useMessages } from "../messages";

export interface ContextOption {
  id: string;
  label: string;
}

/** Active tenant / seller account / marketplace. The data comes from a hook P3-IDENTITY implements (typed stub now). */
export interface ShellContextValue {
  tenantId: string;
  sellerAccountId: string;
  marketplaceId: string;
}
export interface ShellContextOptions {
  tenants: readonly ContextOption[];
  sellerAccounts: readonly ContextOption[];
  marketplaces: readonly ContextOption[];
}

export interface ContextSwitcherProps {
  value: ShellContextValue;
  options: ShellContextOptions;
  onChange: (next: ShellContextValue) => void;
  /** Navbar actions disable during the switch (UX-18). */
  switching?: boolean;
  /** Hide the tenant select when the user has a single tenant. */
  showTenant?: boolean;
}

export function ContextSwitcher({
  value,
  options,
  onChange,
  switching,
  showTenant = true,
}: ContextSwitcherProps) {
  const t = useMessages();
  const select = (
    label: string,
    current: string,
    items: readonly ContextOption[],
    set: (id: string) => void,
  ) => (
    <TextField
      select
      size="small"
      label={label}
      value={current}
      disabled={switching}
      onChange={(e) => set(e.target.value)}
      sx={{ minWidth: 160 }}
    >
      {items.map((o) => (
        <MenuItem key={o.id} value={o.id}>
          {o.label}
        </MenuItem>
      ))}
    </TextField>
  );
  return (
    <Box
      data-testid="context-switcher"
      aria-busy={switching ? true : undefined}
      sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}
    >
      {showTenant && options.tenants.length > 0
        ? select(t("shell.tenant"), value.tenantId, options.tenants, (tenantId) =>
            onChange({ ...value, tenantId }),
          )
        : null}
      {select(
        t("shell.sellerAccount"),
        value.sellerAccountId,
        options.sellerAccounts,
        (sellerAccountId) => onChange({ ...value, sellerAccountId }),
      )}
      {select(t("shell.marketplace"), value.marketplaceId, options.marketplaces, (marketplaceId) =>
        onChange({ ...value, marketplaceId }),
      )}
      {switching ? <span role="status">{t("shell.switching")}</span> : null}
    </Box>
  );
}
