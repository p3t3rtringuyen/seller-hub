"use client";
import Alert from "@mui/material/Alert";
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
import { EmptyState, ErrorCard, StatusChip } from "@seller-hub/ui";
import { useCallback, useEffect, useState } from "react";
import { ApiError, del, get, post, put, type Schemas } from "@/lib/api-client";
import { copy, errorText } from "@/lib/copy";

const t = copy("platform-connections.platform-connections");
type Profile = Schemas["PlatformConnectionsAdsProfile"];
type Marketplace = Schemas["PlatformTenancyAccountMarketplace"];

/** Lists the Ads profiles seen through the Ads connection and lets an admin pick which marketplace each one serves. */
export function AdsProfiles({
  sellerAccountId,
  canManage,
  marketplaces,
}: {
  sellerAccountId: string;
  canManage: boolean;
  marketplaces: readonly Marketplace[];
}) {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setProfiles(
        (await get<{ items: Profile[] }>(`/v1/seller-accounts/${sellerAccountId}/ads/profiles`))
          .items,
      );
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "error", t("errors.generic")));
    }
  }, [sellerAccountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setNotice(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
      setNotice(errorText(t, e));
    }
  };

  if (error && !profiles)
    return (
      <ErrorCard message={errorText(t, error)} status={error.status} onRetry={() => void load()} />
    );

  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-testid="ads-profiles">
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        spacing={1}
      >
        <div>
          <Typography variant="h3" component="h2">
            {t("profiles.title")}
          </Typography>
          <Typography color="text.secondary" variant="body2">
            {t("profiles.intro")}
          </Typography>
        </div>
        {canManage ? (
          <Button
            onClick={() =>
              void act(async () => {
                const r = await post<Schemas["PlatformConnectionsProfilesSynced"]>(
                  `/v1/seller-accounts/${sellerAccountId}/ads/profiles/refresh`,
                );
                setNotice(t("profiles.synced", { count: r.count }));
              })
            }
            data-testid="profiles-refresh"
          >
            {t("profiles.refresh")}
          </Button>
        ) : null}
      </Stack>
      {notice ? (
        <Alert severity="info" sx={{ mt: 1 }}>
          {notice}
        </Alert>
      ) : null}
      {profiles && profiles.length === 0 ? (
        <EmptyState title={t("profiles.empty.title")} description={t("profiles.empty.body")} />
      ) : (
        <Table size="small" sx={{ mt: 1 }}>
          <TableHead>
            <TableRow>
              <TableCell>{t("profiles.country")}</TableCell>
              <TableCell>{t("profiles.name")}</TableCell>
              <TableCell>{t("profiles.type")}</TableCell>
              <TableCell>{t("profiles.currency")}</TableCell>
              <TableCell>{t("profiles.timeZone")}</TableCell>
              <TableCell>{t("profiles.status")}</TableCell>
              <TableCell>{t("profiles.marketplace")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(profiles ?? []).map((p) => {
              const options = marketplaces.filter(
                (m) =>
                  m.countryCode === p.adsCountryCode ||
                  (p.adsCountryCode === "UK" && m.countryCode === "GB"),
              );
              const selected = choice[p.amazonProfileId] ?? options[0]?.marketplaceId ?? "";
              const linked = marketplaces.find((m) => m.marketplaceId === p.linkedMarketplaceId);
              return (
                <TableRow key={p.id} data-testid={`profile-${p.amazonProfileId}`}>
                  <TableCell>{p.adsCountryCode}</TableCell>
                  <TableCell>{p.accountName ?? p.amazonProfileId}</TableCell>
                  <TableCell>{p.accountType}</TableCell>
                  <TableCell>{p.currency ?? "—"}</TableCell>
                  <TableCell>{p.timeZone}</TableCell>
                  <TableCell>
                    <StatusChip status={p.status} label={t(`profiles.status.${p.status}`)} />
                  </TableCell>
                  <TableCell>
                    {p.status === "linked" ? (
                      <Stack direction="row" spacing={1} alignItems="center">
                        <span data-testid="profile-linked">
                          {t("profiles.linkedTo", {
                            name: linked?.name ?? p.linkedMarketplaceId ?? "",
                          })}
                        </span>
                        {canManage ? (
                          <Button
                            size="small"
                            onClick={() =>
                              void act(() =>
                                del(
                                  `/v1/seller-accounts/${sellerAccountId}/ads/profiles/${p.amazonProfileId}/link`,
                                ),
                              )
                            }
                          >
                            {t("profiles.unlink")}
                          </Button>
                        ) : null}
                      </Stack>
                    ) : canManage && p.status === "available" ? (
                      options.length ? (
                        <Stack direction="row" spacing={1} alignItems="center">
                          <TextField
                            select
                            size="small"
                            value={selected}
                            onChange={(e) =>
                              setChoice({ ...choice, [p.amazonProfileId]: e.target.value })
                            }
                            slotProps={{ htmlInput: { "aria-label": t("profiles.marketplace") } }}
                          >
                            {options.map((m) => (
                              <MenuItem key={m.marketplaceId} value={m.marketplaceId}>
                                {m.name}
                              </MenuItem>
                            ))}
                          </TextField>
                          <Button
                            size="small"
                            variant="contained"
                            data-testid={`link-${p.amazonProfileId}`}
                            onClick={() =>
                              void act(() =>
                                put(
                                  `/v1/seller-accounts/${sellerAccountId}/ads/profiles/${p.amazonProfileId}/link`,
                                  { marketplaceId: selected },
                                ),
                              )
                            }
                          >
                            {t("profiles.link")}
                          </Button>
                        </Stack>
                      ) : (
                        t("profiles.noMatch", { country: p.adsCountryCode })
                      )
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Paper>
  );
}
