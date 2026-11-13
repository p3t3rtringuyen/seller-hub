import { execSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

// P3-IDENTITY happy path, through the real stack: web (BFF) -> API -> Postgres, with the mock Amazon transport
// (SH_AMAZON_MODE unset = replay fixtures; no credential, no live call - D30). Needs `pnpm stack:up` + `pnpm db:migrate`.
//
// The first owner is created the way an operator would: `pnpm auth:setup-token` prints a one-time token, the owner pastes it
// at /setup. Every run uses a fresh e-mail and tenant, so reruns need no database reset.

// Next compiles each route on first use in dev mode, so navigations get a generous timeout.
const NAV = { timeout: 45_000 };
test.setTimeout(150_000);

const PASSWORD = "correct horse battery staple";
const SP_TOKEN = "Atzr|e2e-self-authorized-refresh-token-0123456789";

function setupToken(): string {
  const out = execSync("pnpm --filter @seller-hub/mod-platform-auth run setup-token", {
    encoding: "utf8",
  });
  const m = /^\s{2}([A-Za-z0-9_-]{40,})\s*$/m.exec(out);
  if (!m) throw new Error("the setup-token CLI printed no token");
  return m[1]!;
}

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/sign-in");
  await page.getByTestId("signin-email").fill(email);
  await page.getByTestId("signin-password").fill(password);
  await page.getByTestId("signin-submit").click();
}

test("sign in -> tenant -> connect SP-API and Ads (mock Amazon) -> pick a profile; no token reaches the browser", async ({
  page,
  context,
}) => {
  const run = Date.now();
  const email = `owner-${run}@example.test`;

  // --- first owner via the setup token ------------------------------------------------------------------------------
  await page.goto("/setup");
  await page.getByTestId("setup-token").fill(setupToken());
  await page.getByTestId("setup-tenant").fill(`E2E Tenant ${run}`);
  await page.getByTestId("setup-name").fill("Olive Owner");
  await page.getByTestId("setup-email").fill(email);
  await page.getByTestId("setup-password").fill(PASSWORD);
  await page.getByTestId("setup-submit").click();
  await expect(page).toHaveURL(/\/settings\/connections$/, NAV);

  // the session cookie is httpOnly (invisible to JavaScript) and nothing token-like is in storage
  const cookies = await context.cookies();
  const session = cookies.find((c) => /sh_session$/.test(c.name));
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  expect(await page.evaluate(() => document.cookie)).not.toContain("sh_session");
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
  ).not.toContain(session!.value);

  // --- a seller account to connect -----------------------------------------------------------------------------------
  await expect(page.getByTestId("no-seller-account")).toBeVisible(NAV);
  await page.getByTestId("account-name").fill("E2E Seller US");
  await page.getByTestId("account-create").click();
  await expect(page.getByTestId("connections-page")).toBeVisible(NAV);
  await expect(page.getByTestId("current-user")).toHaveText(email);

  // --- SP-API: self-authorization token, validated against the mock transport --------------------------------------
  await page.getByTestId("connect-spapi").click();
  await page.getByTestId("spapi-token").fill(SP_TOKEN);
  await page.getByTestId("spapi-submit").click();
  await expect(page.getByTestId("connections-notice")).toContainText("Amazon.com");
  await expect(page.getByTestId("connection-spapi")).toContainText("Connected");
  // the token is never rendered back
  expect(await page.content()).not.toContain(SP_TOKEN);

  // --- Ads: LWA authorization-code round trip (mock consent) -> profiles -> choose one ------------------------------
  await page.getByTestId("connect-ads").click();
  await expect(page).toHaveURL(/\/settings\/connections$/, NAV);
  await expect(page.getByTestId("connection-ads")).toContainText("Connected", NAV);
  await expect(page).not.toHaveURL(/code=|state=/, NAV); // the code and state were removed from the address bar
  const row = page.getByTestId("profile-1234567890");
  await expect(row).toBeVisible(NAV);
  await row.getByTestId("link-1234567890").click();
  await expect(page.getByTestId("profile-linked")).toContainText("Amazon.com");

  // --- the shell still renders the generated registries (nav, slots, messages) for a signed-in user ---------------------
  await page.goto("/example");
  await expect(page.getByRole("heading", { name: "Example module" })).toBeVisible(NAV);
  await expect(page.getByTestId("nav-entries")).toContainText("/example");
  await expect(page.getByTestId("hello-slot")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toContainText(
    "Connections",
  );

  // --- sign out, then the app is closed to an anonymous browser -------------------------------------------------------
  await page.getByTestId("signout").click();
  await expect(page).toHaveURL(/\/sign-in$/, NAV);
  await page.goto("/settings/connections");
  await expect(page).toHaveURL(/\/sign-in$/, NAV);

  // wrong password first, then the right one
  await signIn(page, email, "not the right password");
  await expect(page.getByTestId("form-error")).toContainText("incorrect");
  await signIn(page, email);
  await expect(page).toHaveURL(/\/settings\/connections$/, NAV);
  await expect(page.getByTestId("connection-ads")).toContainText("Connected");
});

test("an invited viewer can read connections but not manage them (roles are enforced)", async ({
  page,
  browser,
}) => {
  const run = Date.now();
  const owner = `owner2-${run}@example.test`;
  const viewer = `viewer-${run}@example.test`;

  await page.goto("/setup");
  await page.getByTestId("setup-token").fill(setupToken());
  await page.getByTestId("setup-tenant").fill(`E2E Roles ${run}`);
  await page.getByTestId("setup-email").fill(owner);
  await page.getByTestId("setup-password").fill(PASSWORD);
  await page.getByTestId("setup-submit").click();
  await expect(page).toHaveURL(/\/settings\/connections$/, NAV);
  await page.getByTestId("account-name").fill("Roles Seller");
  await page.getByTestId("account-create").click();
  await expect(page.getByTestId("connect-spapi")).toBeVisible(NAV);

  // owner invites a viewer and copies the one-time link
  await page.goto("/settings/members");
  await page.getByTestId("invite-email").fill(viewer);
  await page.getByTestId("invite-submit").click();
  const link = await page.getByTestId("invite-link").inputValue();
  expect(link).toContain("/accept-invitation#token=");

  // the viewer opens the link in a separate browser profile, registers, and lands in the app
  const ctx = await browser.newContext();
  const vpage = await ctx.newPage();
  await vpage.goto(link);
  await vpage.getByTestId("invite-password").fill(PASSWORD);
  await vpage.getByTestId("invite-submit").click();
  await expect(vpage).toHaveURL(/\/settings\/connections$/, NAV);
  expect(vpage.url()).not.toContain("token"); // the token never stays in the address bar
  await expect(vpage.getByTestId("connection-spapi")).toBeVisible(NAV);
  await expect(vpage.getByTestId("connect-spapi")).toHaveCount(0);
  await expect(vpage.getByTestId("connect-ads")).toHaveCount(0);

  // even if the browser tries, the API refuses: the BFF forwards, the API enforces D55
  const res = await vpage.evaluate(async () => {
    const csrf = document.cookie
      .split("; ")
      .find((c) => c.includes("sh_csrf"))!
      .split("=")[1]!;
    const accounts = await (await fetch("/bff/v1/seller-accounts")).json();
    const id = accounts.items[0].id as string;
    const r = await fetch(`/bff/v1/seller-accounts/${id}/connections/ads/authorization`, {
      method: "POST",
      headers: { "x-csrf-token": csrf },
    });
    return { status: r.status, body: await r.json() };
  });
  expect(res.status).toBe(403);
  expect(res.body.code).toBe("forbidden");
  await ctx.close();
});

test("CSRF: a write needs the Origin of this app and the double-submit token", async ({
  request,
}) => {
  const noToken = await request.post("/bff/v1/auth/sign-in", {
    data: { email: "a@example.test", password: "x" },
  });
  expect(noToken.status()).toBe(403);
  expect((await noToken.json()).code).toBe("csrf_failed");

  await request.get("/bff/csrf");
  const jar = await request.storageState();
  const token = jar.cookies.find((c) => c.name.endsWith("sh_csrf"))!.value;
  const foreign = await request.post("/bff/v1/auth/sign-in", {
    data: { email: "a@example.test", password: "x" },
    headers: { "x-csrf-token": token, origin: "https://evil.example" },
  });
  expect(foreign.status()).toBe(403);

  const ok = await request.post("/bff/v1/auth/sign-in", {
    data: { email: "nobody@example.test", password: "wrong wrong wrong" },
    headers: { "x-csrf-token": token },
  });
  expect(ok.status()).toBe(401); // passed the CSRF gate; the credentials are wrong
  expect((await ok.json()).code).toBe("invalid_credentials");
  expect(ok.headers()["set-cookie"] ?? "").not.toContain("sh_session=");
});
