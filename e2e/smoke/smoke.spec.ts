import { expect, test } from "@playwright/test";

// EXAMPLE smoke spec (key "smoke"): the web shell renders, the generated nav/slot/message registries are
// wired, and the BFF refuses writes without CSRF. Slices add e2e/<their-key>/** next to this.
test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("home-title")).toHaveText("seller-hub");
});

test("authenticated pages are closed to an anonymous browser (the shell loads /v1/me)", async ({
  page,
}) => {
  // the shell redirects on the client, which can abort the initial navigation
  await page.goto("/example").catch(() => undefined);
  await expect(page).toHaveURL(/\/sign-in$/, { timeout: 45_000 });
  await expect(page.getByTestId("auth-title")).toHaveText("Sign in");
});

test("BFF refuses a write without the CSRF token with a real 403 problem", async ({ request }) => {
  const res = await request.post("/bff/v1/anything", { data: {} });
  expect(res.status()).toBe(403);
  expect(res.headers()["content-type"]).toContain("application/problem+json");
  const body = await res.json();
  expect(body.code).toBe("csrf_failed");
  expect(body.traceId).toBeTruthy();
});
