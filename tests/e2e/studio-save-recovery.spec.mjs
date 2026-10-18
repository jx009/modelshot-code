import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { getTestEnvironment } from "../support/environment.mjs";
import { E2E_PASSWORD } from "../support/e2e-users.mjs";
import { readStudioDraft } from "../support/studio-draft.mjs";

test("autosave recovers a committed write whose response is lost, preserving edits during retry", async ({ page }, info) => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: getTestEnvironment().databaseUrl }) });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    const email = `save-recovery-${info.project.name}-${Date.now()}@modelshot.test`;
    const user = await db.user.create({ data: { email, passwordHash: await bcrypt.hash(E2E_PASSWORD, 10), credits: 100, emailVerified: new Date() } });
    const doc = await db.studioDocument.create({ data: { userId: user.id, name: "Recovery canvas",
      content: { schemaVersion: 1, layers: [], jobs: [], messages: [], appliedJobs: [], plan: null } } });
    await page.goto(`/en/login?callbackUrl=${encodeURIComponent(`/en/studio-v2?document=${doc.id}`)}`);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".ms-project-trigger")).toContainText("Recovery canvas");
    const requests = [];
    let committed = false;
    await page.route("**/api/studio/documents", async route => {
      if (route.request().method() !== "POST") return route.continue();
      requests.push(route.request().postDataJSON());
      if (requests.length !== 1) return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      committed = true;
      await gate;
      await route.fulfill({ status: 502, contentType: "text/html", body: "<html>Bad gateway</html>" });
    });
    const composer = page.getByRole("textbox", { name: "Creative prompt", exact: true });
    await composer.fill("First unsent prompt");
    await expect.poll(() => committed).toBe(true);
    await composer.fill("Latest edit must survive the lost response");
    release();
    await expect(page.locator(".ms-project-trigger")).toContainText("Saved to cloud");
    await expect.poll(async () => (await db.studioDocument.findUnique({ where: { id: doc.id } })).content.composer?.text)
      .toBe("Latest edit must survive the lost response");
    expect(requests[1]).toEqual(requests[0]);
    expect((await db.studioDocument.findUnique({ where: { id: doc.id } })).version).toBe(3);
    await expect(page.locator(".ms-notice")).toHaveCount(0);
    await expect.poll(async () => (await readStudioDraft(page))?._dirty).toBe(false);
    await page.reload();
    await expect(composer).toHaveValue("Latest edit must survive the lost response");
    await expect(page.locator(".ms-save-conflict")).toHaveCount(0);
  } finally {
    release();
    await db.$disconnect();
  }
});
