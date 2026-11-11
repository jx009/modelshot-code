import { expect } from "@playwright/test";

export async function waitForToolViewport(page) {
  const stage = page.locator(".ms-stage");
  await expect(stage).toHaveAttribute("data-camera-moving", "false");
  await expect.poll(async () => {
    const bounds = await stage.boundingBox(), panel = await page.locator(".ms-editor").boundingBox();
    const image = JSON.parse(await stage.getAttribute("data-selection-frame"));
    if (!bounds || !panel || !image || await stage.getAttribute("data-camera-moving") !== "false") return false;
    const left = bounds.x + image.left, top = bounds.y + image.top;
    const unobstructed = left + image.width <= panel.x - 12 || left >= panel.x + panel.width + 12
      || top + image.height <= panel.y - 12 || top >= panel.y + panel.height + 12;
    return image.left >= 0 && image.top >= 0 && image.left + image.width <= bounds.width + 1
      && image.top + image.height <= bounds.height + 1 && unobstructed;
  }).toBe(true);
}
