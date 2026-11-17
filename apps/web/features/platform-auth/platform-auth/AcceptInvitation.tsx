"use client";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { post, type Schemas } from "@/lib/api-client";
import { copy, errorText } from "@/lib/copy";
import { AuthCard } from "./AuthCard";

const t = copy("platform-auth.platform-auth");

/**
 * The invitation link carries its token in the URL FRAGMENT (`/accept-invitation#token=…`): fragments are never sent to a
 * server, proxy or access log. The page moves it into memory and clears the address bar before doing anything else.
 */
export function AcceptInvitation() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [preview, setPreview] = useState<Schemas["PlatformAuthInvitationPreview"] | null>(null);
  const [state, setState] = useState<"loading" | "missing" | "invalid" | "ready">("loading");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const m = /(?:^#|&)token=([A-Za-z0-9_-]+)/.exec(window.location.hash);
    window.history.replaceState(null, "", window.location.pathname);
    if (!m) {
      setState("missing");
      return;
    }
    const value = m[1]!;
    setToken(value);
    post<Schemas["PlatformAuthInvitationPreview"]>("/v1/auth/invitations/preview", { token: value })
      .then((p) => {
        setPreview(p);
        setState("ready");
      })
      .catch(() => setState("invalid"));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token || !preview) return;
    setBusy(true);
    setError(null);
    try {
      if (preview.accountExists) {
        // one call: checks the password and joins, also for an account that belongs to no tenant right now
        await post("/v1/auth/invitations/accept-with-password", { token, password });
      } else {
        await post("/v1/auth/invitations/register", {
          token,
          password,
          ...(displayName ? { displayName } : {}),
        });
      }
      router.replace("/settings/connections");
    } catch (err) {
      setError(errorText(t, err));
      setBusy(false);
    }
  }

  if (state === "loading") return <AuthCard title={t("invite.titleGeneric")} />;
  if (state !== "ready" || !preview)
    return (
      <AuthCard title={t("invite.titleGeneric")}>
        <Alert severity="error" data-testid="form-error">
          {state === "missing" ? t("invite.missing") : t("invite.invalid")}
        </Alert>
      </AuthCard>
    );

  return (
    <AuthCard
      title={t("invite.titleGeneric")}
      subtitle={t("invite.intro", { role: preview.role, email: preview.email })}
    >
      <form onSubmit={submit} noValidate>
        <Stack spacing={2}>
          {preview.accountExists ? <Typography>{t("invite.signInFirst")}</Typography> : null}
          {error ? (
            <Alert severity="error" data-testid="form-error">
              {error}
            </Alert>
          ) : null}
          {preview.accountExists ? null : (
            <TextField
              label={t("invite.displayName")}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
            />
          )}
          <TextField
            label={preview.accountExists ? t("signIn.password") : t("invite.password")}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={preview.accountExists ? "current-password" : "new-password"}
            slotProps={{ htmlInput: { "data-testid": "invite-password" } }}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={busy || !password}
            data-testid="invite-submit"
          >
            {preview.accountExists ? t("invite.accept") : t("invite.register")}
          </Button>
        </Stack>
      </form>
    </AuthCard>
  );
}
