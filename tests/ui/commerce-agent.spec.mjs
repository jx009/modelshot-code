import { test, expect } from "@playwright/test";
import sharp from "sharp";
import JSZip from "jszip";
import fs from "node:fs/promises";

const brief = { product: "休闲椅", brand: "物间", description: "为这把蓝色椅子做三张生活方式图片", imageCount: 3, platform: "taobao", region: "CN", language: "zh", style: "natural", theme: "linen", caseId: "", material: "", dimensions: "", audience: "", scenario: "" };
const cards = Array.from({ length: 3 }, (_, index) => ({ id: `card-${index}`, kind: "lifestyle", title: ["让日常慢下来", "一处安静角落", "属于你的时光"][index], body: "让这把蓝色椅子融入家中的日常。", eyebrow: "", layout: "inset", purpose: "展示真实空间中的比例", direction: "暖白色空间、柔和自然光，保留椅子原始外观。", evidence: "用户上传的蓝色椅子", prompt: "Preserve original chair; create lifestyle image", attempt: 0 }));
async function fixture(page, { preloaded = false, loseFirstResponse = false } = {}) {
  const png = await sharp({ create: { width: 512, height: 768, channels: 3, background: "#88a79b" } }).png().toBuffer();
  let doc = preloaded ? makeDoc() : null, jobs = [], turns = [], writes = [], uploads = 0, lastKey;
  const keys = [];
  function makeDoc() { return { id: "commerce-project", version: 1, name: brief.description, content: { schemaVersion: 1, layers: [{ id: "source", type: "image", assetId: "product", name: "Product", x: 0, y: 0, width: 400, height: 600, pixelWidth: 512, pixelHeight: 768, visible: true, opacity: 1, rotation: 0 }], messages: [{ id: "u1", role: "user", text: brief.description }, { id: "a1", role: "assistant", text: "用三张图讲清产品、生活场景与空间比例。" }], jobs: [], appliedJobs: [], commerce: { version: 1, brief, productAssetId: "product", sections: structuredClone(cards), planning: "agent", size: "1024x1536", agent: { summary: "三张图", styleLock: "柔和自然光、暖白空间、保留产品外观", evidence: ["用户上传的蓝色椅子"], questions: [], lastTurn: "fixture-turn-key-1234", lastTurnDigest: "digest" } } } }; }
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = data => route.fulfill({ json: data });
    if (path.startsWith("/api/assets/")) return route.fulfill({ body: png, contentType: "image/png" });
    if (path === "/api/auth/session") return json({ user: { id: "agent-ui", name: "Creator", email: "agent@example.invalid", credits: 500 }, expires: "2099-01-01" });
    if (path === "/api/studio/capabilities") return json({ imageProvider: "image-a", imageModels: [{ id: "image-a", label: "Image A", creditCost: 7, maxReferenceImages: 3 }, { id: "image-b", label: "Image B", creditCost: 9, maxReferenceImages: 3 }], planningCost: 2, planningAvailable: true, tools: [{ id: "edit", available: true, cost: request.url().includes("image-b") ? 9 : 7 }] });
    if (path === "/api/upload") { uploads++; return json({ assetId: uploads === 1 ? "product" : "style", width: 512, height: 768 }); }
    if (path === "/api/commerce/plan") {
      const body = request.postDataJSON(); turns.push(body);
      const key = request.headers()["idempotency-key"]; keys.push(key);
      if (lastKey === key) return json({ document: doc, replayed: true });
      lastKey = key;
      if (!doc) doc = makeDoc(); else {
        doc.version++;
        if (!body.reviewJobId) doc.content.commerce.sections = doc.content.commerce.sections.map(s => s.id === body.targetSectionId ? { ...s, title: "户外的安静角落", attempt: s.attempt + 1, revisionAssetId: "output-card-1-0" } : s);
        doc.content.messages.push({ id: `u${turns.length + 1}`, role: "user", text: body.message }, { id: `a${turns.length + 1}`, role: "assistant", text: body.reviewJobId ? "产品一致性良好，标题需要更醒目。建议增大标题。" : "仅修改第二张，其他图片保持不变。" });
      }
      doc.content.commerce.provider = body.provider;
      if (loseFirstResponse && turns.length === 1) return route.abort("failed");
      return json({ document: doc });
    }
    if (path === "/api/studio/jobs") return json(jobs);
    if (path === "/api/commerce/run") {
      const body = request.postDataJSON();
      const rows = body.sectionIds.map(id => {
        const section = doc.content.commerce.sections.find(s => s.id === id);
        return { id: `job-${id}-${section.attempt}`, documentId: doc.id, sectionId: id, sectionAttempt: section.attempt, status: "succeeded", resultData: { assets: [{ id: `output-${id}-${section.attempt}`, width: 512, height: 768 }] } };
      });
      jobs = [...rows, ...jobs.filter(j => !rows.some(r => r.id === j.id))]; return json({ jobs: rows, failure: null });
    }
    if (path === "/api/studio/documents" && request.method() === "POST") { const body = request.postDataJSON(); writes.push(body); doc = { ...doc, ...body, version: doc.version + 1 }; return json(doc); }
    if (path === "/api/studio/documents/commerce-project") return json(doc);
    if (path === "/api/studio/documents") return json(doc ? [doc] : []);
    return json({ items: [], credits: 500 });
  });
  return { turns, writes, keys, getDoc: () => doc };
}

test("agent plans a dynamic set, revises one result, and retains all images in the same project", async ({ page }, info) => {
  const f = await fixture(page), errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/zh/commerce");
  await page.getByLabel("上传商品原图", { exact: true }).setInputFiles("public/inspiration/chair.webp");
  await page.getByLabel("产品名称", { exact: true }).fill(brief.product);
  await page.getByLabel("产品事实与要求").fill(brief.description);
  await page.getByLabel("图片数量").selectOption("3");
  await page.getByRole("button", { name: "开始策划", exact: true }).click();
  await expect(page.locator(".ca-card")).toHaveCount(3);
  expect(f.turns[0].brief.imageCount).toBe(3);
  await expect(page.getByRole("button", { name: /生成待办 3 张/ })).toContainText("21 积分");
  await page.getByRole("button", { name: /生成待办 3 张/ }).click();
  await expect(page.locator(".ca-card-image img")).toHaveCount(3);
  await expect.poll(() => f.getDoc().content.layers.length).toBe(4);
  const target = page.locator(".ca-card").nth(1);
  await target.getByRole("button", { name: "修改", exact: true }).click();
  await page.getByLabel("继续创作").fill("换成户外场景，其他保持不变");
  await page.getByRole("button", { name: "发送修改要求" }).click();
  expect(f.turns[1].documentId).toBe("commerce-project");
  expect(f.turns[1].targetSectionId).toBe("card-1");
  await expect(page.locator(".ca-card-image img")).toHaveCount(2);
  await page.getByRole("button", { name: /生成待办 1 张/ }).click();
  await expect.poll(() => f.getDoc().content.layers.length).toBe(5);
  expect(f.getDoc().name).toBe(brief.description);
  expect(f.getDoc().content.layers.map(l => l.assetId)).toContain("output-card-1-0");
  await target.getByRole("button", { name: /检查/ }).click();
  await expect(page.locator(".ca-messages")).toContainText("建议增大标题");
  await page.screenshot({ path: info.outputPath("commerce-agent-desktop.png"), fullPage: true });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载已完成图片与方案" }).click();
  const zip = await JSZip.loadAsync(await fs.readFile(await (await downloadPromise).path()));
  expect(Object.keys(zip.files).filter(name => name.endsWith(".png"))).toHaveLength(3);
  expect((await sharp(await zip.file("01-card-0.png").async("nodebuffer")).metadata()).width).toBe(512);
  await page.getByRole("button", { name: "打开画布" }).click();
  await expect(page).toHaveURL(/studio-v2\?document=commerce-project/);
  expect(f.writes.every(w => w.id === "commerce-project")).toBe(true);
  expect(errors).toEqual([]);
});

test("a lost planning response is recoverable after reload with the original request key", async ({ page }) => {
  const f = await fixture(page, { loseFirstResponse: true });
  await page.goto("/zh/commerce");
  await page.getByLabel("上传商品原图", { exact: true }).setInputFiles("public/inspiration/chair.webp");
  await page.getByLabel("产品名称", { exact: true }).fill(brief.product);
  await page.getByLabel("产品事实与要求").fill(brief.description);
  await page.getByRole("button", { name: "开始策划", exact: true }).click();
  await expect(page.getByRole("button", { name: "恢复上次请求" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "恢复上次请求" }).click();
  await expect(page.locator(".ca-card")).toHaveCount(3);
  expect(f.keys).toHaveLength(2);
  expect(f.keys[0]).toBe(f.keys[1]);
  expect(f.turns[0]).toEqual(f.turns[1]);
});

for (const [theme, width] of [["light", 1440], ["dark", 390]]) {
  test(`${theme} commerce workspace is readable and contained at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 }); await fixture(page, { preloaded: true });
    await page.goto("/zh/commerce?document=commerce-project");
    await expect(page.locator(".ca-card")).toHaveCount(3);
    await page.evaluate(theme => document.documentElement.setAttribute("data-theme", theme), theme);
    await page.getByRole("button", { name: "商品资料", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    for (const selector of [".ca-conversation", ".ca-card", ".ca-composer"]) {
      const color = await page.locator(selector).first().evaluate(el => getComputedStyle(el).backgroundColor);
      expect(color).toMatch(/^rgb\(/);
    }
    await page.getByLabel("继续创作").focus();
    await page.screenshot({ path: info.outputPath(`commerce-${theme}-${width}.png`), fullPage: true });
  });
}
