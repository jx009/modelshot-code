import { test, expect } from "@playwright/test";

async function fixtures(page, state = {}) {
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/invite") {
      if (state.failed) return route.fulfill({ status: state.failed, json: { error: "UNAVAILABLE" } });
      if (url.searchParams.get("tab") === "commissions") return route.fulfill({ json: { commissions: [
        { id: "c1", orderAmount: 100, commissionRate: 0.1, commissionAmount: 10, currency: "cny", status: "pending", createdAt: "2026-10-20T00:00:00Z" },
        { id: "c2", orderAmount: 20, commissionRate: 0.1, commissionAmount: 2, currency: "usd", status: "settled", createdAt: "2026-10-19T00:00:00Z" },
      ] } });
      return route.fulfill({ json: { inviteCode: "TEST26", summary: { inviteeCount: 12, paidInviteeCount: 3, totalOrderAmount: 100, pendingCommission: 10, settledCommission: 20 }, invitees: [
        { id: "i1", emailMasked: "cr***@example.com", invitedAt: "2026-10-20T00:00:00Z", hasPaid: true, paidAmount: 100 },
        { id: "i2", name: "新用户", invitedAt: "2026-10-21T00:00:00Z", hasPaid: false, paidAmount: 0 },
      ] } });
    }
    const data = {
      "/api/auth/session": { user: { id: "invite-user", role: state.role || "agent", email: "invite@example.invalid", credits: 500 }, expires: "2099-01-01T00:00:00Z" },
      "/api/studio/documents": { items: [], nextCursor: null },
      "/api/studio/capabilities": { imageModels: [], tools: [] },
      "/api/inspiration": { items: [], layout: { mode: "masonry", columns: 4, gap: 16 } },
      "/api/announcements/current": { announcement: { id: "mobile-notice", revision: "1", title: "让想象，一键成真", content: "来塔绘梦上线内测中，新用户注册赠送 100 积分。", style: "info", closable: true } },
    };
    return route.fulfill({ json: data[url.pathname] || {} });
  });
}

async function openInvite(page) {
  await page.getByRole("button", { name: "invite@example.invalid" }).click();
  await page.getByRole("menuitem", { name: "邀请中心" }).click();
  const dialog = page.getByRole("dialog", { name: "邀请中心" });
  await expect(dialog.getByText("TEST26", { exact: true })).toBeVisible();
  return dialog;
}

for (const theme of ["dark", "light"]) for (const width of [1440, 390]) {
  test(`invite opens in place with copy, currency and commissions (${theme}, ${width})`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: 820 });
    await page.addInitScript(value => localStorage.setItem("theme", value), theme);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await fixtures(page);
    await page.goto("/zh");
    const url = page.url();
    const prompt = page.locator("textarea").first();
    await prompt.fill("保留这段创作草稿");
    const dialog = await openInvite(page);
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await dialog.getByRole("button", { name: "复制", exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`${new URL(url).origin}/zh/login?ref=TEST26`);
    await dialog.getByRole("combobox", { name: "业绩币种" }).selectOption("usd");
    await expect(dialog.getByRole("cell", { name: "US$100.00", exact: true })).toBeVisible();
    await dialog.getByRole("combobox", { name: "业绩币种" }).selectOption("cny");
    await expect(dialog.getByRole("cell", { name: "¥100.00", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`invite-${theme}-${width}.png`), animations: "disabled" });
    await dialog.getByRole("button", { name: "佣金明细" }).click();
    await expect(dialog.getByRole("cell", { name: "待结算", exact: true })).toBeVisible();
    await expect(dialog.getByRole("cell", { name: "已结算", exact: true })).toBeVisible();
    await expect(dialog.getByRole("cell", { name: "US$2.00", exact: true })).toBeVisible();
    const rect = await dialog.boundingBox();
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(width);
    await expect(dialog.getByRole("button", { name: "关闭邀请中心" })).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "invite@example.invalid" })).toBeFocused();
    await expect(prompt).toHaveValue("保留这段创作草稿");
    await expect(page).toHaveURL(url);
  });
}

test("invite failures retry and forbidden users cannot see data", async ({ page }) => {
  const state = { failed: 503 };
  await fixtures(page, state);
  await page.goto("/zh?panel=invite");
  const dialog = page.getByRole("dialog", { name: "邀请中心" });
  await expect(dialog.getByRole("alert")).toContainText("邀请数据加载失败");
  state.failed = 0;
  await dialog.getByRole("button", { name: "重新加载" }).click();
  await expect(dialog.getByText("TEST26", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "关闭邀请中心" }).click();
  await expect(page).toHaveURL(/\/zh$/);
  state.failed = 403;
  await openInviteWithoutData(page);
  await expect(dialog.getByRole("alert")).toContainText("邀请中心对合作伙伴开放");
  await expect(dialog.locator("input")).toHaveCount(0);
});

async function openInviteWithoutData(page) {
  await page.getByRole("button", { name: "invite@example.invalid" }).click();
  await page.getByRole("menuitem", { name: "邀请中心" }).click();
}

test("old invite URLs open the modal, while ordinary members keep the invite entry hidden", async ({ page }) => {
  await fixtures(page);
  await page.goto("/zh/invite");
  await expect(page).toHaveURL(/\/zh\?panel=invite$/);
  await expect(page.getByRole("dialog", { name: "邀请中心" }).getByText("TEST26", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/zh$/);
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/en/invite");
  await expect(page.getByRole("dialog", { name: "Invite & Earn" })).toBeVisible();
  await page.keyboard.press("Escape");
  await fixtures(page, { role: "user" });
  await page.goto("/zh");
  await page.getByRole("button", { name: "invite@example.invalid" }).click();
  await expect(page.getByRole("menuitem", { name: "邀请中心" })).toHaveCount(0);
});

for (const theme of ["dark", "light"]) for (const width of [320, 390]) {
  test(`mobile navigation is collapsed and opens a labeled drawer (${theme}, ${width})`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 740 });
    await page.addInitScript(value => localStorage.setItem("theme", value), theme);
    await fixtures(page);
    await page.goto("/zh");
    await expect(page.locator(".cr-sidebar")).toBeHidden();
    const trigger = page.getByRole("button", { name: "打开导航菜单" });
    const drawer = page.getByRole("dialog", { name: "创作导航" });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(drawer).toHaveCount(0);
    await expect(page.getByRole("button", { name: "invite@example.invalid" })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: "积分充值" })).toContainText("500");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`mobile-collapsed-${theme}-${width}.png`), animations: "disabled" });
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(drawer.getByRole("navigation").getByRole("link")).toHaveCount(6);
    await expect(drawer.getByRole("link", { name: "创作首页" })).toHaveAttribute("aria-current", "page");
    await expect(drawer.getByRole("link", { name: "自由画布" })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`mobile-drawer-${theme}-${width}.png`), animations: "disabled" });
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.mouse.click(width - 5, 400);
    await expect(drawer).toHaveCount(0);
    await trigger.click();
    await drawer.getByRole("link", { name: "我的项目" }).click();
    await expect(page).toHaveURL(/\/zh\/projects$/);
    await expect(drawer).toHaveCount(0);
    await trigger.click();
    await expect(drawer.getByRole("link", { name: "我的项目" })).toHaveAttribute("aria-current", "page");
    await drawer.getByRole("button", { name: "关闭导航菜单" }).click();
    await expect(trigger).toBeFocused();
  });
}

test("mobile drawer closes on desktop resize and desktop keeps its sidebar", async ({ page }) => {
  await fixtures(page);
  await page.setViewportSize({ width: 390, height: 820 });
  await page.goto("/zh");
  await page.getByRole("button", { name: "打开导航菜单" }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("dialog", { name: "创作导航" })).toHaveCount(0);
  await expect(page.locator(".cr-sidebar")).toBeVisible();
  await expect(page.getByRole("button", { name: "打开导航菜单" })).toBeHidden();
});

test("mobile menu remains usable in the floating topbar after scrolling", async ({ page }) => {
  await fixtures(page);
  await page.setViewportSize({ width: 390, height: 500 });
  await page.goto("/zh");
  await page.evaluate(() => window.scrollTo(0, 220));
  await expect(page.locator(".cr-topbar")).toHaveAttribute("data-scrolled", "true");
  const trigger = page.getByRole("button", { name: "打开导航菜单" });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "创作导航" });
  await expect(drawer).toBeVisible();
  expect((await drawer.boundingBox()).y).toBe(0);
  await expect(drawer.getByRole("button", { name: "关闭导航菜单" })).toBeInViewport({ ratio: 1 });
  const scroll = await page.evaluate(() => window.scrollY);
  await page.mouse.move(380, 300);
  await page.mouse.wheel(0, 200);
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
