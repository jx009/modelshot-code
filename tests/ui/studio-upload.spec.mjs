import { test, expect } from "@playwright/test";

const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC", "base64");

async function setup(page) {
  const uploads = [];
  await page.route("**/api/**", route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    const reply = json => route.fulfill({ json });
    if (pathname === "/api/auth/session") return reply({ user: { id: "upload-user", name: "Creator", credits: 100 }, expires: "2099-01-01" });
    if (pathname === "/api/studio/documents/upload-doc") return reply({ id: "upload-doc", version: 1, name: "Upload", content: { schemaVersion: 1, layers: [], messages: [], jobs: [], appliedJobs: [] } });
    if (pathname === "/api/studio/documents/upload-doc/view") return reply({ camera: { x: 0, y: 0, scale: 1 } });
    if (pathname === "/api/upload/direct") return reply({ mode: "proxy" });
    if (pathname === "/api/upload") {
      uploads.push(request.postDataBuffer());
      return reply({ assetId: `uploaded-${uploads.length}`, width: 80, height: 60 });
    }
    if (pathname.startsWith("/api/assets/")) return route.fulfill({ contentType: "image/png", body: image });
    if (pathname === "/api/studio/capabilities") return reply({ imageModels: [], tools: [] });
    if (pathname === "/api/studio/jobs" || pathname === "/api/library/categories") return reply([]);
    return reply({ items: [], credits: 100 });
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/zh/studio-v2?document=upload-doc");
  await expect(page.getByRole("textbox", { name: "创作描述" })).toBeEnabled();
  return uploads;
}

async function pasteImage(page, selector = "body") {
  return page.evaluate(({ selector, encoded }) => {
    const clipboardData = new DataTransfer();
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    clipboardData.items.add(new File([bytes], "screenshot.png", { type: "image/png" }));
    const event = new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true });
    document.querySelector(selector).dispatchEvent(event);
    return event.defaultPrevented;
  }, { selector, encoded: image.toString("base64") });
}

test("local upload remains available on both empty and populated canvases", async ({ page }) => {
  const uploads = await setup(page);
  for (const count of [1, 2]) {
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "本地上传", exact: true }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: `local-${count}.png`, mimeType: "image/png", buffer: image });
    await expect(page.locator(".ms-canvas-label")).toContainText(`${count} 个图层`);
    await expect(page.getByRole("button", { name: "本地上传", exact: true })).toBeEnabled();
  }
  expect(uploads).toHaveLength(2);
  await expect(page.getByRole("dialog", { name: "选择素材" })).toHaveCount(0);
});

test("pastes an image into the canvas and adds prompt images as references", async ({ page }) => {
  const uploads = await setup(page);
  expect(await pasteImage(page)).toBe(true);
  await expect(page.locator(".ms-canvas-label")).toContainText("1 个图层");
  await expect(page.getByRole("button", { name: "本地上传", exact: true })).toBeEnabled();
  await page.getByRole("textbox", { name: "创作描述" }).fill("keep my prompt");
  expect(await pasteImage(page, '[data-image-paste="reference"]')).toBe(true);
  await expect(page.locator(".ms-canvas-label")).toContainText("2 个图层");
  await expect(page.locator(".ms-reference-list")).toContainText("screenshot.png");
  await expect(page.getByRole("textbox", { name: "创作描述" })).toHaveValue("keep my prompt");
  expect(uploads).toHaveLength(2);
});

test("preserves text paste and does not import images through an open dialog", async ({ page }) => {
  const uploads = await setup(page);
  const prevented = await page.locator('[data-image-paste="reference"]').evaluate(target => {
    const clipboardData = new DataTransfer(); clipboardData.setData("text/plain", "hello");
    const event = new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "选择素材" })).toBeVisible();
  expect(await pasteImage(page, "dialog")).toBe(false);
  expect(uploads).toHaveLength(0);
});

test("reference picker offers local files without opening the asset library", async ({ page }) => {
  const uploads = await setup(page);
  await page.getByRole("button", { name: "添加参考图", exact: true }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "从电脑上传", exact: true }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: "reference.png", mimeType: "image/png", buffer: image });
  await expect(page.locator(".ms-reference-list")).toContainText("reference.png");
  await expect(page.locator(".ms-canvas-label")).toContainText("1 个图层");
  await expect(page.getByRole("dialog", { name: "选择素材" })).toHaveCount(0);
  expect(uploads).toHaveLength(1);
});
