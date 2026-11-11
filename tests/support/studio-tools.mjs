import { expect } from "@playwright/test";

const groups = {
  "AI upscale": "Image quality",
  "Reverse prompt": "Reverse prompt",
  "Local edit": "Local edit",
  "Recognize text": "Image text",
  "Remove background": "Cutout & layers",
  "Split layers": "Cutout & layers",
  "Move object": "Cutout & layers",
  "Crop image": "More",
  "Download image": "More",
};

export async function imageTool(page, name) {
  const toolbar = page.getByRole("group", { name: "Image tools", exact: true });
  await expect(toolbar).toBeVisible();
  const group = groups[name];
  if (!group) return toolbar.getByRole("button", { name, exact: true });
  await toolbar.getByRole("button", { name: group, exact: true }).press("ArrowDown");
  return page.getByRole("menu", { name: group, exact: true }).getByRole("menuitem", { name, exact: true });
}

export async function expectOriginalDownload(page, assetId) {
  const download = await imageTool(page, "Download image");
  await expect(download).toHaveAttribute("href", `/api/assets/${assetId}?delivery=auto&download=1`);
  await page.keyboard.press("Escape");
}
