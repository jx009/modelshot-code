import { expect } from "@playwright/test";

export async function waitForToolViewport(page) {
  const stage = page.locator(".ms-stage");
  await expect(stage).toHaveAttribute("data-camera-moving", "false");
  await expect.poll(async () => {
    const bounds = await stage.boundingBox(), panel = await page.locator(".ms-editor").boundingBox();
    const image = JSON.parse(await stage.getAttribute("data-selection-frame"));
    return Boolean(bounds && panel && image && image.left >= 0 && image.top >= 0 && image.left + image.width <= bounds.width + 1 && bounds.y + image.top + image.height <= panel.y - 12);
  }).toBe(true);
}
