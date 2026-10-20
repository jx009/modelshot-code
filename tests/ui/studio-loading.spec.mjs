import { test, expect } from "@playwright/test";
import sharp from "sharp";

async function fixture(page, failDocument = false, jobs = []) {
  const counts = { document: 0, capabilities: 0, jobs: 0, originals: 0, sessionUpdates: 0 };
  const png = await sharp({ create: { width: 600, height: 450, channels: 3, background: "#b7c7b1" } }).png().toBuffer();
  const doc = { id: "loading-doc", version: 1, name: "加载测试", content: { schemaVersion: 1, layers: [{ id: "layer", type: "image", assetId: "image", name: "Image", x: 90, y: 100, width: 480, height: 360, pixelWidth: 4096, pixelHeight: 3072, visible: true, opacity: 1 }], messages: [], jobs: [], appliedJobs: [] } };
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url());
    const reply = json => route.fulfill({ json });
    if (url.pathname === "/api/auth/session") {
      if (request.method() === "POST") { counts.sessionUpdates++; await new Promise(resolve => setTimeout(resolve, 250)); }
      return reply({ user: { id: "loading-user", name: "Creator", email: "loading@example.invalid", credits: 500 }, expires: "2099-01-01" });
    }
    if (url.pathname === "/api/auth/csrf") return reply({ csrfToken: "fixture" });
    if (url.pathname === "/api/studio/documents/loading-doc") {
      counts.document++;
      if (failDocument && counts.document === 1) return route.fulfill({ status: 503, json: { code: "TEMPORARILY_UNAVAILABLE" } });
      return reply(doc);
    }
    if (url.pathname === "/api/studio/documents/loading-doc/view") return reply({ camera: { x: 0, y: 0, scale: 1 } });
    if (url.pathname === "/api/studio/capabilities") { counts.capabilities++; return reply({ imageProvider: "fixture", imageModels: [{ id: "fixture", label: "Fixture", creditCost: 18 }], tools: [] }); }
    if (url.pathname === "/api/studio/jobs") { counts.jobs++; return reply(url.searchParams.has("paged") ? { items: jobs, nextCursor: null } : jobs); }
    if (url.pathname === "/api/assets/image") {
      if (!url.searchParams.has("preview")) counts.originals++;
      return route.fulfill({ body: png, contentType: "image/png" });
    }
    return reply({ items: [], credits: 500 });
  });
  return counts;
}

test("session refresh keeps the canvas open without refetching document, tools or tasks", async ({ page }) => {
  const counts = await fixture(page);
  await page.goto("/zh/studio-v2?document=loading-doc");
  await expect(page.getByRole("textbox", { name: "创作描述" })).toBeEnabled();
  await expect.poll(() => counts.jobs).toBe(1);
  await expect.poll(() => counts.capabilities).toBe(1);
  const response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/auth/session" && r.request().method() === "POST");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("textbox", { name: "创作描述" })).toBeEnabled();
  await response;
  await page.waitForTimeout(1000);
  expect(counts).toEqual({ document: 1, capabilities: 1, jobs: 1, originals: 0, sessionUpdates: 1 });
});

test("failed document opening exposes retry instead of an endless loading state", async ({ page }) => {
  const counts = await fixture(page, true);
  await page.goto("/zh/studio-v2?document=loading-doc");
  await page.getByRole("button", { name: "重试打开", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "创作描述" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "重试打开", exact: true })).toHaveCount(0);
  expect(counts.document).toBe(2);
});

test("task history opens from the canvas without adding tool records to chat", async ({ page }) => {
  await fixture(page, false, [
    { id: "completed", documentId: "loading-doc", origin: "canvas", tool: "generate", status: "succeeded", createdAt: "2026-09-01T10:00:00Z", resultData: { assets: [{ id: "result", width: 600, height: 450, contentType: "image/png" }] } },
    { id: "failed", documentId: "loading-doc", origin: "canvas", tool: "expand", status: "failed", createdAt: "2026-09-01T11:00:00Z", errorCode: "PROVIDER_REJECTED" },
  ]);
  await page.goto("/zh/studio-v2?document=loading-doc");
  const trigger = page.locator(".ms-canvas-space").getByRole("button", { name: "任务列表", exact: true });
  await expect(trigger).toBeVisible();
  await expect(page.locator(".ms-task-popover")).toHaveCount(0);
  await trigger.click();
  const panel = page.getByRole("region", { name: "当前项目任务" });
  await expect(panel.locator('[data-state="complete"]')).toContainText("已完成");
  await expect(panel.locator('[data-state="failed"]')).toContainText("任务失败");
  await panel.getByRole("button", { name: "查看全部任务记录" }).click();
  await expect(panel.locator(".ms-task-card")).toHaveCount(2);
  await panel.getByRole("button", { name: "定位结果" }).click();
  await expect(page.locator(".ms-chat .ms-task-center, .ms-chat-activity, .ms-message.assistant")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await panel.getByRole("button", { name: "关闭任务列表" }).click();
  await expect(panel).toHaveCount(0);
});
