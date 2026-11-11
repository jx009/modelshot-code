export async function creativeLink(page, name) {
  const desktop = page.getByRole("navigation", { name: "Creative navigation", exact: true }).getByRole("link", { name, exact: true });
  if (await desktop.isVisible()) return desktop;
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  return page.getByRole("dialog", { name: "Creative navigation", exact: true }).getByRole("link", { name, exact: true });
}
