"use client";
import { useCan } from "@seller-hub/ui";
import { useCallback, useEffect, useState } from "react";
import { useShellSession } from "../../../(shell)/session";
import { copy } from "./copy";
import { SyncStatusView } from "./SyncStatusView";
import type { SyncHealth, SyncHealthItem } from "./sync-types";

// Container: fetches the sync health of the current seller account through the BFF (never Amazon, never the DB)
// and starts a refresh. The BFF/API routes are served by the API layer; until they exist the screen shows its error
// state with Retry, which is the intended behaviour (UX-20).

interface ProblemBody {
  title?: string;
  detail?: string;
  code?: string;
}

export function SyncStatusScreen() {
  const { context } = useShellSession();
  const canRefresh = useCan("sync.refresh");
  const accountId = context.sellerAccountId;
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [data, setData] = useState<SyncHealth>();
  const [error, setError] = useState<{ message: string; status?: number | string }>();
  const [refreshing, setRefreshing] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string }>();

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch(
        `/bff/v1/seller-accounts/${encodeURIComponent(accountId)}/sync-health`,
        { headers: { accept: "application/json" } },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ProblemBody;
        setError({
          message: body.detail ?? body.title ?? `HTTP ${res.status}`,
          status: body.code ?? res.status,
        });
        setState("error");
        return;
      }
      setData((await res.json()) as SyncHealth);
      setState("ready");
    } catch (e) {
      setError({ message: (e as Error).message });
      setState("error");
    }
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshNow = useCallback(
    async (item: SyncHealthItem) => {
      const id = `${item.syncKey}|${item.scopeKey}`;
      setRefreshing((s) => new Set(s).add(id));
      setNotice(undefined);
      try {
        const res = await fetch(
          `/bff/v1/seller-accounts/${encodeURIComponent(accountId)}/sync/${encodeURIComponent(item.syncKey)}/refresh`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ scopeKey: item.scopeKey }),
          },
        );
        setNotice(
          res.ok
            ? { kind: "success", text: copy.refreshQueued }
            : { kind: "error", text: copy.refreshFailed },
        );
        if (res.ok) void load();
      } catch {
        setNotice({ kind: "error", text: copy.refreshFailed });
      } finally {
        setRefreshing((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      }
    },
    [accountId, load],
  );

  return (
    <SyncStatusView
      state={state}
      data={data}
      error={error}
      canRefresh={canRefresh}
      onReload={() => void load()}
      onRefreshNow={(i) => void refreshNow(i)}
      refreshing={refreshing}
      notice={notice}
    />
  );
}
