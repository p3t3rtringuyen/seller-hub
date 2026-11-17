"use client";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, post } from "@/lib/api-client";
import { copy, errorText } from "@/lib/copy";
import { AuthCard } from "./AuthCard";

const t = copy("platform-auth.platform-auth");

/** First-owner setup: there is no default admin; the operator prints a one-time token (pnpm auth:setup-token). */
export function SetupForm() {
  const router = useRouter();
  const [f, setF] = useState({
    setupToken: "",
    tenantName: "",
    displayName: "",
    email: "",
    password: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    void fetch("/bff/csrf", { credentials: "same-origin", cache: "no-store" });
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post("/v1/auth/setup", {
        setupToken: f.setupToken.trim(),
        tenantName: f.tenantName,
        email: f.email,
        password: f.password,
        ...(f.displayName ? { displayName: f.displayName } : {}),
      });
      router.replace("/settings/connections");
    } catch (err) {
      const fieldCode = err instanceof ApiError ? err.errors[0]?.code : undefined;
      setError(
        fieldCode && t(`errors.${fieldCode}`) !== `errors.${fieldCode}`
          ? t(`errors.${fieldCode}`)
          : errorText(t, err),
      );
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t("setup.title")} subtitle={t("setup.subtitle")}>
      <form onSubmit={submit} noValidate>
        <Stack spacing={2}>
          {error ? (
            <Alert severity="error" data-testid="form-error">
              {error}
            </Alert>
          ) : null}
          <TextField
            label={t("setup.token")}
            value={f.setupToken}
            onChange={set("setupToken")}
            required
            autoComplete="off"
            slotProps={{ htmlInput: { "data-testid": "setup-token" } }}
          />
          <TextField
            label={t("setup.tenantName")}
            value={f.tenantName}
            onChange={set("tenantName")}
            required
            slotProps={{ htmlInput: { "data-testid": "setup-tenant" } }}
          />
          <TextField
            label={t("setup.displayName")}
            value={f.displayName}
            onChange={set("displayName")}
            autoComplete="name"
            slotProps={{ htmlInput: { "data-testid": "setup-name" } }}
          />
          <TextField
            label={t("setup.email")}
            type="email"
            value={f.email}
            onChange={set("email")}
            required
            autoComplete="username"
            slotProps={{ htmlInput: { "data-testid": "setup-email" } }}
          />
          <TextField
            label={t("setup.password")}
            type="password"
            value={f.password}
            onChange={set("password")}
            required
            autoComplete="new-password"
            slotProps={{ htmlInput: { "data-testid": "setup-password" } }}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={busy || !f.setupToken || !f.tenantName || !f.email || !f.password}
            data-testid="setup-submit"
          >
            {t("setup.submit")}
          </Button>
        </Stack>
      </form>
    </AuthCard>
  );
}
