"use client";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { ConfirmDialog, EmptyState, ErrorCard, Modal, StatusChip } from "@seller-hub/ui";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError, del, get, post, type Schemas } from "@/lib/api-client";
import { copy, errorText } from "@/lib/copy";
import { useShellSession } from "../../../app/(shell)/session";
import { AdsProfiles } from "./AdsProfiles";

const t = copy("platform-connections.platform-connections");
export type Connection = Schemas["PlatformConnectionsConnection"];
type Api = "spapi" | "ads";

export function ConnectionsPage() {
  const session = useShellSession();
  const accountId = session.context.sellerAccountId;
  const canManage =
    session.sellerPermissions.includes("connections.manage") ||
    session.permissions.includes("connections.manage");
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<{ severity: "error" | "success"; text: string } | null>(
    null,
  );
  const [spapiOpen, setSpapiOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState<Api | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!accountId) return;
    try {
      setConnections(
        (await get<{ items: Connection[] }>(`/v1/seller-accounts/${accountId}/connections`)).items,
      );
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e : new ApiError(0, "error", t("errors.generic")));
    }
  }, [accountId]);

  useEffect(() => {
    setConnections(null);
    void reload();
  }, [reload]);

  if (session.loading) return null;
  if (!accountId)
    return (
      <NoSellerAccount
        canCreate={session.permissions.includes("connections.manage")}
        onCreated={async () => {
          await session.reload();
        }}
      />
    );
  if (loadError)
    return (
      <ErrorCard
        message={errorText(t, loadError)}
        status={loadError.status}
        onRetry={() => void reload()}
      />
    );

  const by = (api: Api) => connections?.find((c) => c.api === api) ?? null;

  async function startAds() {
    setBusy(true);
    setNotice(null);
    try {
      const r = await post<Schemas["PlatformConnectionsAuthorizationStarted"]>(
        `/v1/seller-accounts/${accountId}/connections/ads/authorization`,
      );
      window.location.assign(r.authorizationUrl);
    } catch (e) {
      setNotice({ severity: "error", text: errorText(t, e) });
      setBusy(false);
    }
  }

  async function disconnect() {
    const api = disconnecting;
    if (!api) return;
    try {
      await del(`/v1/seller-accounts/${accountId}/connections/${api}`);
      setDisconnecting(null);
      await reload();
    } catch (e) {
      setDisconnecting(null);
      setNotice({ severity: "error", text: errorText(t, e) });
    }
  }

  return (
    <Stack spacing={3} data-testid="connections-page">
      <Typography color="text.secondary">{t("intro")}</Typography>
      {notice ? (
        <Alert severity={notice.severity} data-testid="connections-notice">
          {notice.text}
        </Alert>
      ) : null}
      <ConnectionCard
        api="spapi"
        connection={by("spapi")}
        loading={connections === null}
        canManage={canManage}
        onConnect={() => setSpapiOpen(true)}
        onDisconnect={() => setDisconnecting("spapi")}
      />
      <ConnectionCard
        api="ads"
        connection={by("ads")}
        loading={connections === null}
        canManage={canManage}
        busy={busy}
        onConnect={() => void startAds()}
        onDisconnect={() => setDisconnecting("ads")}
      />
      {by("ads")?.status === "active" ? (
        <AdsProfiles
          sellerAccountId={accountId}
          canManage={canManage}
          marketplaces={session.marketplaces}
        />
      ) : null}

      <SpapiDialog
        open={spapiOpen}
        sellerAccountId={accountId}
        onClose={() => setSpapiOpen(false)}
        onConnected={async (text) => {
          setSpapiOpen(false);
          setNotice({ severity: "success", text });
          await reload();
        }}
      />
      <ConfirmDialog
        open={disconnecting !== null}
        title={t("disconnectTitle", { api: disconnecting ? t(`api.${disconnecting}`) : "" })}
        consequence={t("disconnectConsequence")}
        confirmLabel={t("disconnectConfirm")}
        destructive
        onConfirm={() => void disconnect()}
        onCancel={() => setDisconnecting(null)}
      />
    </Stack>
  );
}

function ConnectionCard({
  api,
  connection,
  loading,
  canManage,
  busy,
  onConnect,
  onDisconnect,
}: {
  api: Api;
  connection: Connection | null;
  loading: boolean;
  canManage: boolean;
  busy?: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const status = connection?.status ?? "none";
  const connected = status === "active";
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");
  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-testid={`connection-${api}`}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        spacing={2}
        flexWrap="wrap"
        useFlexGap
      >
        <Box sx={{ maxWidth: 560 }}>
          <Typography variant="h3" component="h2">
            {t(`api.${api}`)}
          </Typography>
          <Typography color="text.secondary" variant="body2">
            {t(`api.${api}Help`)}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
            {loading ? null : (
              <StatusChip
                status={status === "none" ? "inactive" : status}
                label={t(`status.${status}`)}
              />
            )}
            {connection?.connectedAt ? (
              <Typography variant="body2">
                {t("connectedAt", { when: when(connection.connectedAt) })}
              </Typography>
            ) : null}
          </Stack>
          {connection?.lastErrorCode ? (
            <Typography variant="body2" color="error">
              {t("lastError", { code: connection.lastErrorCode })}
            </Typography>
          ) : null}
          {connected ? (
            <Typography variant="caption" color="text.secondary" display="block">
              {t("syncUnknown")}
            </Typography>
          ) : null}
        </Box>
        {canManage ? (
          <Stack direction="row" spacing={1}>
            <Button
              variant={connected ? "outlined" : "contained"}
              onClick={onConnect}
              disabled={busy}
              data-testid={`connect-${api}`}
            >
              {status === "none" || status === "revoked" ? t("connect") : t("reconnect")}
            </Button>
            {connection && connection.status !== "revoked" ? (
              <Button color="error" onClick={onDisconnect} data-testid={`disconnect-${api}`}>
                {t("disconnect")}
              </Button>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  );
}

function SpapiDialog({
  open,
  sellerAccountId,
  onClose,
  onConnected,
}: {
  open: boolean;
  sellerAccountId: string;
  onClose: () => void;
  onConnected: (text: string) => Promise<void>;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<Schemas["PlatformConnectionsSpapiConnected"]>(
        `/v1/seller-accounts/${sellerAccountId}/connections/spapi/self-authorization`,
        { refreshToken: token },
      );
      setToken(""); // the secret does not stay in component state
      await onConnected(
        t("spapi.success", {
          count: r.marketplaces.length,
          names: r.marketplaces.map((m) => m.name).join(", "),
        }),
      );
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={t("spapi.dialogTitle")}
      onClose={() => {
        setToken("");
        setError(null);
        onClose();
      }}
    >
      <form onSubmit={submit} noValidate>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error ? (
            <Alert severity="error" data-testid="spapi-error">
              {error}
            </Alert>
          ) : null}
          <TextField
            label={t("spapi.token")}
            helperText={t("spapi.tokenHelp")}
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            required
            slotProps={{ htmlInput: { "data-testid": "spapi-token", spellCheck: false } }}
          />
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button onClick={onClose}>{t("cancel")}</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={busy || token.trim().length < 20}
              data-testid="spapi-submit"
            >
              {t("spapi.submit")}
            </Button>
          </Stack>
        </Stack>
      </form>
    </Modal>
  );
}

function NoSellerAccount({
  canCreate,
  onCreated,
}: {
  canCreate: boolean;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [region, setRegion] = useState("NA");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!canCreate)
    return <EmptyState title={t("noAccount.title")} description={t("noAccount.viewer")} />;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post("/v1/seller-accounts", { name, regionCode: region });
      await onCreated();
    } catch (err) {
      setError(errorText(t, err));
      setBusy(false);
    }
  }
  return (
    <Paper variant="outlined" sx={{ p: 3, maxWidth: 520 }} data-testid="no-seller-account">
      <Typography variant="h3" component="h2">
        {t("noAccount.title")}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {t("noAccount.body")}
      </Typography>
      <form onSubmit={submit} noValidate>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField
            label={t("account.name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            slotProps={{ htmlInput: { "data-testid": "account-name" } }}
          />
          <TextField
            select
            label={t("account.region")}
            value={region}
            onChange={(e) => setRegion(e.target.value)}
          >
            {["NA", "EU", "FE"].map((r) => (
              <MenuItem key={r} value={r}>
                {t(`region.${r}`)}
              </MenuItem>
            ))}
          </TextField>
          <Button
            type="submit"
            variant="contained"
            disabled={busy || !name.trim()}
            data-testid="account-create"
          >
            {t("account.create")}
          </Button>
        </Stack>
      </form>
    </Paper>
  );
}
