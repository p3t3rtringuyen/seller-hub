import { expect, test } from "@playwright/test";

// EXAMPLE smoke spec (key "smoke"): the web shell renders, the generated nav/slot/message registries are
// wired, and the BFF placeholder refuses writes. Slices add e2e/<their-key>/** next to this.
test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("home-title")).toHaveText("seller-hub");
});

test("example page uses the generated registries (nav, slots, messages)", async ({ page }) => {
  await page.goto("/example");
  await expect(page.getByRole("heading", { name: "Example module" })).toBeVisible();
  await expect(page.getByTestId("nav-entries")).toContainText("/example");
  await expect(page.getByTestId("hello-slot")).toBeVisible();
});

test("BFF placeholder answers writes with a real 501 problem", async ({ request }) => {
  const res = await request.post("/bff/v1/anything", { data: {} });
  expect(res.status()).toBe(501);
  expect(res.headers()["content-type"]).toContain("application/problem+json");
  expect((await res.json()).traceId).toBeTruthy();
});
