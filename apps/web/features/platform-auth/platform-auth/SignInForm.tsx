"use client";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { post } from "@/lib/api-client";
import { copy, errorText, safeNext } from "@/lib/copy";
import { AuthCard } from "./AuthCard";

const t = copy("platform-auth.platform-auth");

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The csrf cookie must exist before the first write; the form has no session yet.
  useEffect(() => {
    void fetch("/bff/csrf", { credentials: "same-origin", cache: "no-store" });
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post("/v1/auth/sign-in", { email, password });
      const next = safeNext(new URLSearchParams(window.location.search).get("next"));
      router.replace(next);
    } catch (err) {
      setError(errorText(t, err));
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t("signIn.title")} subtitle={t("signIn.subtitle")}>
      <form onSubmit={submit} noValidate>
        <Stack spacing={2}>
          {error ? (
            <Alert severity="error" data-testid="form-error">
              {error}
            </Alert>
          ) : null}
          <TextField
            label={t("signIn.email")}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            slotProps={{ htmlInput: { "data-testid": "signin-email" } }}
          />
          <TextField
            label={t("signIn.password")}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            slotProps={{ htmlInput: { "data-testid": "signin-password" } }}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={busy || !email || !password}
            data-testid="signin-submit"
          >
            {busy ? t("signIn.submitting") : t("signIn.submit")}
          </Button>
        </Stack>
      </form>
    </AuthCard>
  );
}
