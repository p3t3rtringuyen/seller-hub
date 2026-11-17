"use client";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { ConfirmDialog, EmptyState, ErrorCard, StatusChip, useCan } from "@seller-hub/ui";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError, del, get, post, put, type Schemas } from "@/lib/api-client";
import { copy, errorText } from "@/lib/copy";
import { useShellSession } from "../../../app/(shell)/session";

const t = copy("platform-tenancy.platform-tenancy");
type Member = Schemas["PlatformTenancyMember"];
type Invitation = Schemas["PlatformTenancyInvitation"];
const ROLES = ["owner", "admin", "manager", "analyst", "viewer"] as const;
const INVITABLE = ["admin", "manager", "analyst", "viewer"] as const;

export function MembersPage() {
  const { me, loading } = useShellSession();
  const canManage = useCan("members.manage");
  const isOwner = me?.roles.includes("owner") ?? false;
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<{ severity: "error" | "success"; text: string } | null>(
    null,
  );
  const [removing, setRemoving] = useState<Member | null>(null);
  const [created, setCreated] = useState<{ email: string; link: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      const m = await get<{ items: Member[] }>("/v1/members");
      setMembers(m.items);
      if (canManage) setInvitations((await get<{ items: Invitation[] }>("/v1/invitations")).items);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e : new ApiError(0, "error", t("errors.generic")));
    }
  }, [canManage]);

  useEffect(() => {
    if (!loading) void reload();
  }, [loading, reload]);

  const fail = (e: unknown) => setNotice({ severity: "error", text: errorText(t, e) });

  async function changeRole(m: Member, role: string) {
    setNotice(null);
    try {
      await put(`/v1/members/${m.membershipId}/roles`, {
        grants: [{ role, sellerAccountId: null }],
      });
      await reload();
    } catch (e) {
      fail(e);
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    try {
      await del(`/v1/members/${removing.membershipId}`);
      setRemoving(null);
      await reload();
    } catch (e) {
      setRemoving(null);
      fail(e);
    }
  }

  if (loading) return null;
  if (loadError)
    return (
      <ErrorCard
        message={errorText(t, loadError)}
        status={loadError.status}
        onRetry={() => void reload()}
      />
    );

  return (
    <Stack spacing={3} data-testid="members-page">
      <Typography color="text.secondary">{t("members.intro")}</Typography>
      {notice ? <Alert severity={notice.severity}>{notice.text}</Alert> : null}

      <Paper variant="outlined">
        {members && members.length === 0 ? (
          <EmptyState title={t("members.empty")} />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t("members.email")}</TableCell>
                <TableCell>{t("members.name")}</TableCell>
                <TableCell>{t("members.role")}</TableCell>
                <TableCell>{t("members.scope")}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {(members ?? []).map((m) => {
                const wide = m.grants.find((g) => g.sellerAccountId === null);
                const editable =
                  canManage &&
                  (isOwner ||
                    (wide?.role !== "owner" && m.grants.every((g) => g.role !== "owner")));
                return (
                  <TableRow key={m.membershipId} data-testid={`member-${m.email}`}>
                    <TableCell>{m.email}</TableCell>
                    <TableCell>{m.displayName ?? "—"}</TableCell>
                    <TableCell>
                      {editable && wide ? (
                        <TextField
                          select
                          size="small"
                          value={wide.role}
                          onChange={(e) => void changeRole(m, e.target.value)}
                          slotProps={{ htmlInput: { "aria-label": t("members.role") } }}
                        >
                          {ROLES.filter((r) => isOwner || r !== "owner").map((r) => (
                            <MenuItem key={r} value={r}>
                              {t(`role.${r}`)}
                            </MenuItem>
                          ))}
                        </TextField>
                      ) : (
                        <StatusChip
                          status={wide?.role ?? "viewer"}
                          label={m.grants.map((g) => t(`role.${g.role}`)).join(", ")}
                          tone="neutral"
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {wide ? t("members.scopeAll") : `${m.grants.length} account(s)`}
                    </TableCell>
                    <TableCell align="right">
                      {editable ? (
                        <Button size="small" color="error" onClick={() => setRemoving(m)}>
                          {t("members.remove")}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Paper>

      {canManage ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h3" component="h2" sx={{ mb: 1 }}>
            {t("invitations.title")}
          </Typography>
          <InviteForm
            onCreated={async (r) => {
              setCreated(r);
              await reload();
            }}
            onError={fail}
          />
          {created ? (
            <Alert severity="success" sx={{ mt: 2 }} data-testid="invite-created">
              <strong>{t("invitations.linkTitle")}</strong>
              <Box sx={{ my: 1 }}>{t("invitations.linkHelp", { email: created.email })}</Box>
              <TextField
                fullWidth
                size="small"
                value={created.link}
                slotProps={{
                  htmlInput: {
                    readOnly: true,
                    "data-testid": "invite-link",
                    "aria-label": "Invitation link",
                  },
                }}
              />
            </Alert>
          ) : null}
          <Table size="small" sx={{ mt: 2 }}>
            <TableBody>
              {(invitations ?? []).length === 0 ? (
                <TableRow>
                  <TableCell>{t("invitations.empty")}</TableCell>
                </TableRow>
              ) : (
                (invitations ?? []).map((inv) => {
                  const status = inv.acceptedAt
                    ? "accepted"
                    : inv.revokedAt
                      ? "revoked"
                      : new Date(inv.expiresAt) < new Date()
                        ? "expired"
                        : "open";
                  return (
                    <TableRow key={inv.id}>
                      <TableCell>{inv.email}</TableCell>
                      <TableCell>{t(`role.${inv.role}`)}</TableCell>
                      <TableCell>
                        <StatusChip status={status} label={t(`invitations.${status}`)} />
                      </TableCell>
                      <TableCell align="right">
                        {status === "open" ? (
                          <Button
                            size="small"
                            onClick={() =>
                              void del(`/v1/invitations/${inv.id}`).then(reload).catch(fail)
                            }
                          >
                            {t("invitations.revoke")}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Paper>
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        title={t("members.removeTitle", { email: removing?.email ?? "" })}
        consequence={t("members.removeConsequence")}
        confirmLabel={t("members.removeConfirm")}
        destructive
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoving(null)}
      />
    </Stack>
  );
}

function InviteForm({
  onCreated,
  onError,
}: {
  onCreated: (r: { email: string; link: string }) => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof INVITABLE)[number]>("viewer");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await post<Schemas["PlatformTenancyInvitationCreated"]>("/v1/invitations", {
        email,
        role,
      });
      setEmail("");
      await onCreated({ email: r.invitation.email, link: r.link });
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} noValidate>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "flex-start" }}>
        <TextField
          size="small"
          type="email"
          label={t("invitations.email")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          sx={{ minWidth: 260 }}
          slotProps={{ htmlInput: { "data-testid": "invite-email" } }}
        />
        <TextField
          select
          size="small"
          label={t("invitations.role")}
          value={role}
          onChange={(e) => setRole(e.target.value as typeof role)}
          sx={{ minWidth: 160 }}
          helperText={t(`roleHelp.${role}`)}
        >
          {INVITABLE.map((r) => (
            <MenuItem key={r} value={r}>
              {t(`role.${r}`)}
            </MenuItem>
          ))}
        </TextField>
        <Button
          type="submit"
          variant="contained"
          disabled={busy || !email}
          data-testid="invite-submit"
        >
          {t("invitations.send")}
        </Button>
      </Stack>
    </form>
  );
}
