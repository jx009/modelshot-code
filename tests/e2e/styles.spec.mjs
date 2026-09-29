import { test, expect } from "@playwright/test";
import { E2E_PASSWORD, E2E_USERS } from "../support/e2e-users.mjs";

async function expectTheme(page, theme) {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("body")).toHaveCSS("background-color", theme === "dark" ? "rgb(10, 10, 11)" : "rgb(246, 246, 243)");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

for (const theme of ["light", "dark"]) {
  test(`${theme} styles survive direct loads and client navigation`, async ({ page }, info) => {
    await page.addInitScript(value => localStorage.setItem("theme", value), theme);
    await page.goto("/en/login?callbackUrl=/en");
    await page.getByRole("button", { name: "Email", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill(E2E_USERS[0].email);
    await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/en$/);
    await expectTheme(page, theme);
    await page.getByLabel("Describe your idea").focus();
    await expect(page.getByLabel("Describe your idea")).toHaveCSS("outline-style", "none");
    await expect(page.locator(".cr-logo")).toHaveCSS("text-decoration-line", "none");
    await expect(page.locator(".cr-case-art").first()).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await page.screenshot({ path: info.outputPath(`home-${theme}.png`), fullPage: true });
    for (const [name, path] of [["Explore", "/en/explore"], ["My projects", "/en/projects"], ["Assets", "/en/assets"]]) {
      await page.getByRole("navigation", { name: "Creative navigation" }).getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expectTheme(page, theme);
      await page.screenshot({ path: info.outputPath(`${name}-${theme}.png`), fullPage: true });
      await page.reload();
      await expectTheme(page, theme);
    }
    await page.goto("/en/studio-v2");
    await expect(page.getByLabel("Creative prompt")).toBeVisible();
    await expectTheme(page, theme);
    await page.screenshot({ path: info.outputPath(`studio-${theme}.png`), fullPage: true });
  });
}

test("a failed global stylesheet recovers without reloading or losing input", async ({ page }) => {
  let blocked = false, retries = 0, documents = 0;
  page.on("request", request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++; });
  await page.route("**/_next/static/**/*.css*", async route => {
    if (route.request().url().includes("style-retry=")) { retries++; return route.continue(); }
    const response = await route.fetch();
    if (!blocked && (await response.text()).includes("--bg-page:")) { blocked = true; return route.abort(); }
    return route.fulfill({ response });
  });
  await page.goto("/zh");
  await page.getByLabel("描述你的创意").fill("保留我正在输入的创意");
  await expectTheme(page, "dark");
  await expect(page.locator(".cr-logo")).toHaveCSS("text-decoration-line", "none");
  await expect(page.getByLabel("描述你的创意")).toHaveValue("保留我正在输入的创意");
  expect(blocked).toBe(true);
  expect(retries).toBe(1);
  expect(documents).toBe(1);
});

test("slow navigation reports progress and repeated clicks share one request", async ({ page }) => {
  let count = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("**/en/projects?*", async route => {
    count++;
    await gate;
    await route.continue();
  });
  await page.goto("/en");
  const link = page.getByRole("navigation", { name: "Creative navigation" }).getByRole("link", { name: "My projects", exact: true });
  expect(count).toBe(0);
  try {
    await link.click();
    await expect(page.getByRole("status").filter({ hasText: "Opening" })).toBeVisible();
    await link.click(); await link.click();
    await expect.poll(() => count).toBe(1);
  } finally { release(); }
  await expect(page).toHaveURL(/\/en\/projects$/);
  await expect(page.getByRole("heading", { name: "My projects", exact: true })).toBeVisible();
});

test("a persistently unavailable stylesheet offers recovery without a reload loop", async ({ page }) => {
  let requests = 0;
  await page.route("**/_next/static/**/*.css*", route => { requests++; return route.abort(); });
  await page.goto("/zh");
  await expect(page.getByRole("alert").filter({ hasText: "页面样式加载失败" })).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新页面", exact: true })).toBeVisible();
  await page.getByLabel("描述你的创意").fill("未保存的输入");
  await expect(page.getByLabel("描述你的创意")).toHaveValue("未保存的输入");
  expect(requests).toBeLessThan(30);
});
