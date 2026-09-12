import { test, expect } from "@playwright/test";
import { E2E_PASSWORD, E2E_USERS } from "../support/e2e-users.mjs";

async function signIn(page, email, destination = "/en/studio") {
  await page.goto(`/en/login?callbackUrl=${encodeURIComponent(destination)}`);
  await page.getByRole("button", { name: "Email", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${destination}$`));
  await expect.poll(async () => (await (await page.request.get("/api/auth/session")).json()).user?.email).toBe(email);
}

for (const locale of ["en", "zh"]) {
  test(`${locale} public workspace renders without runtime errors`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const response = await page.goto(`/${locale}/studio`);
    expect(response.status()).toBe(200);
    await expect(page.locator("h1")).toContainText(locale === "en" ? "Photo studio" : "拍摄工作台");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    // Language names in the navigation remain in their native language.
    if (locale === "en") expect(await page.locator(".studio-shell").innerText()).not.toMatch(/\p{Script=Han}/u);
    expect(errors).toEqual([]);
  });
}

test("email sign-in restores the workspace and exposes no credential", async ({ page }, testInfo) => {
  await signIn(page, E2E_USERS[0].email);
  const session = await (await page.request.get("/api/auth/session")).json();
  expect(session.user.email).toBe(E2E_USERS[0].email);
  expect(session.user.role).toBe("user");
  expect(session.user).not.toHaveProperty("customApiKey");
  await page.reload();
  expect((await (await page.request.get("/api/auth/session")).json()).user.email).toBe(E2E_USERS[0].email);
  await page.screenshot({ path: testInfo.outputPath("studio.png"), fullPage: true });
  await page.goto("/en/gallery");
  await expect(page.getByText("No shots yet", { exact: true })).toBeVisible();
});

test("a normal account cannot access admin data", async ({ page }) => {
  await signIn(page, E2E_USERS[0].email);
  const response = await page.request.get("/api/admin/users");
  expect(response.status()).toBe(403);
});

test("admin filtering and refresh use the actual protected API", async ({ page }) => {
  await signIn(page, E2E_USERS[1].email, "/en/admin/orders");
  await expect(page.getByText("暂无订单", { exact: true })).toBeVisible();
  const pending = page.waitForResponse(response => response.url().includes("/api/admin/orders?") && new URL(response.url()).searchParams.get("status") === "paid");
  await page.locator("select").first().selectOption("paid");
  expect((await pending).status()).toBe(200);
  await expect(page.getByText("暂无订单", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.getByText("暂无订单", { exact: true })).toBeVisible();
});

test("unsafe legacy entry points are unavailable", async ({ request }) => {
  const providers = await (await request.get("/api/auth/providers")).json();
  expect(providers).not.toHaveProperty("credentials");
  expect((await request.post("/api/checkout", { data: { planId: "basic" } })).status()).toBe(503);
  expect((await request.post("/api/user/apikey", { data: { apiKey: "same-suffix" } })).status()).toBe(404);
  expect((await request.post("/api/user/credentials", { data: { provider: "openai", secret: "unused" } })).status()).toBe(404);
  expect((await request.get("/uploads/legacy.png")).status()).toBe(404);
});
