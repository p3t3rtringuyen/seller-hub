"use client";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { post, type Schemas } from "@/lib/api-client";
import { copy, errorText } from "@/lib/copy";

const t = copy("platform-connections.platform-connections");

/**
 * Landing page of the Ads consent redirect (`?code=…&state=…`). The code and state are read once, removed from the
 * address bar at once (history, referrers) and sent to the BFF in a POST body - never logged as a query string. The
 * server verifies the state it stored for this user and exchanges the code; the browser never sees a token.
 */
export function AdsCallback() {
  const router = useRouter();
  const [state, setState] = useState<"working" | "done" | "error">("working");
  const [message, setMessage] = useState("");
  const ran = useRef(false); // React strict mode runs effects twice; the state is single use

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const oauthState = params.get("state");
    window.history.replaceState(null, "", window.location.pathname);
    if (!code || !oauthState) {
      setState("error");
      setMessage(t("errors.state_invalid"));
      return;
    }
    post<Schemas["PlatformConnectionsAdsConnected"]>("/v1/connections/ads/callback", {
      code,
      state: oauthState,
    })
      .then((r) => {
        setState("done");
        setMessage(`${t("ads.callbackDone")} ${t("profiles.synced", { count: r.profiles.count })}`);
        window.setTimeout(() => router.replace("/settings/connections"), 1200);
      })
      .catch((e) => {
        setState("error");
        setMessage(errorText(t, e));
      });
  }, [router]);

  return (
    <Stack spacing={2} data-testid="ads-callback" sx={{ maxWidth: 520 }}>
      {state === "working" ? <Typography>{t("ads.callbackWorking")}</Typography> : null}
      {state === "done" ? (
        <Alert severity="success" data-testid="ads-callback-done">
          {message}
        </Alert>
      ) : null}
      {state === "error" ? (
        <Alert severity="error" data-testid="ads-callback-error">
          {message}
        </Alert>
      ) : null}
      {state !== "working" ? (
        <Button onClick={() => router.replace("/settings/connections")}>
          {t("ads.callbackBack")}
        </Button>
      ) : null}
    </Stack>
  );
}
