import { readStudioDraft } from "../support/studio-draft.mjs";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { getTestEnvironment } from "../support/environment.mjs";
import { E2E_PASSWORD } from "../support/e2e-users.mjs";

test("one send generates directly; failed preview preserves input and retries without another charge", async ({ page }, info) => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: getTestEnvironment().databaseUrl }) });
  const email = `delivery-${info.project.name}-${Date.now()}@modelshot.test`;
  const posted = [], plans = [], errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/api/studio/jobs")) posted.push(request.postDataJSON()); if (request.url().endsWith("/api/studio/plan")) plans.push(request.url()); });
  const draft = () => readStudioDraft(page);
  try {
    await db.user.create({ data: { email, passwordHash: await bcrypt.hash(E2E_PASSWORD, 10), credits: 100, emailVerified: new Date() } });
    await page.goto("/en/login?callbackUrl=" + encodeURIComponent("/en/studio-v2?mode=chat&prompt=A%20cat"));
    await page.getByRole("button", { name: "Email", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
    const submitted = page.waitForResponse(r => r.url().endsWith("/api/studio/jobs") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Generate · 18 credits", exact: true }).click();
    const generated = await (await submitted).json();
    await expect.poll(async () => (await draft())?.appliedJobs?.includes(generated.id), { timeout: 45000 }).toBe(true);
    expect(posted).toHaveLength(1); expect(posted[0].tool).toBe("generate"); expect(plans).toEqual([]);
    await expect(page.locator(".ms-plan")).toHaveCount(0);
    const first = (await draft()).layers.find(layer => layer.visible);
    await expect(page.getByRole("link", { name: "Download", exact: true })).toHaveAttribute("href", `/api/assets/${first.assetId}`);
    const preview = await page.request.get(`/api/assets/${first.assetId}?preview=320`);
    expect(preview.headers()["content-type"]).toBe("image/webp");
    expect(await sharp(await preview.body()).metadata()).toMatchObject({ width: 320, height: 320 });

    // Optional object editing goes through the segmentation API, then the durable worker.
    await page.getByRole("button", { name: /Local edit/ }).click();
    await page.getByRole("button", { name: "Detect object", exact: true }).click();
    const box = await page.locator(".ms-stage").boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByLabel("Object edit instruction")).toBeVisible({ timeout: 20000 });
    await page.getByLabel("Object edit instruction").fill("Raise one paw FIXTURE_DELAY");
    let rejectPreview = true;
    const blockPreview = async route => {
      if (rejectPreview && !route.request().url().includes(first.assetId)) await route.abort(); else await route.continue();
    };
    await page.route(/\/api\/assets\/.*_studio_0\?preview=1280$/, blockPreview);
    const editing = page.waitForResponse(r => r.url().endsWith("/api/studio/jobs") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Apply edit 18 credits", exact: true }).click();
    const editJob = await (await editing).json();
    await expect(page.getByRole("button", { name: "Upload image", exact: true })).toBeEnabled();
    await expect(page.locator(".ms-task-status")).toContainText("original kept");
    await expect(page.locator(".ms-task-status").getByRole("button", { name: "Retry loading" })).toBeVisible({ timeout: 45000 });
    expect((await draft()).layers.find(layer => layer.id === first.id).visible).toBe(true);
    expect((await draft()).appliedJobs).not.toContain(editJob.id);
    rejectPreview = false;
    await page.locator(".ms-task-status").getByRole("button", { name: "Retry loading" }).click();
    await expect.poll(async () => (await draft()).appliedJobs.includes(editJob.id)).toBe(true);
    const edited = (await draft()).layers.find(layer => layer.sourceJobId === editJob.id);
    expect((await draft()).layers.filter(layer => layer.visible)).toHaveLength(2);
    expect(edited.x).toBeGreaterThan(first.x + first.width);
    expect(edited.assetId).not.toBe(first.assetId);
    await expect(page.getByRole("link", { name: "Download", exact: true })).toHaveAttribute("href", `/api/assets/${edited.assetId}`);
    expect(posted).toHaveLength(2); expect(plans).toEqual([]);
    expect((await (await page.request.get("/api/usage")).json()).credits).toBe(64);
    await expect(page.locator(".ms-notice")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("complete-edit-ready.png"), fullPage: true });
    // The server snapshot was saved before this result arrived. Reopening it
    // must recover the completed job even though it was loaded once already.
    await page.locator(".ms-project-trigger").click();
    await page.locator(".ms-project-list button").first().click();
    await expect.poll(async () => (await draft()).appliedJobs.includes(editJob.id)).toBe(true);
    await expect(page.getByRole("link", { name: "Download", exact: true })).toHaveAttribute("href", `/api/assets/${edited.assetId}`);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect((await draft()).layers.find(layer => layer.id === first.id).visible).toBe(true);
    await page.reload();
    await expect.poll(async () => (await draft()).layers.find(layer => layer.id === first.id)?.visible).toBe(true);
    expect(errors).toEqual([]);
  } finally { await db.$disconnect(); }
});
