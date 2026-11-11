import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

// Browser behavior and layout evidence only: no supplier requests or charges.
const variants = [{ id: "hd", label: "高清", resolution: "720p", audio: false, creditCost: 20, durations: [5, 10], ratios: ["16:9", "9:16"] }];
const caps = { video: true, motion: true, videoProvider: "frames",
  videoModels: [{ id: "frames", label: "首尾帧模型", available: true, cost: 20, durations: [5, 10], ratios: ["16:9", "9:16"], inputMode: "both", referenceLayout: "frames", mediaLimits: { image: 2 }, variants }],
  tools: [{ id: "video", available: true, cost: 20 }, { id: "motion-plan", available: true, cost: 2 }, { id: "motion-render", available: true, cost: 0 }],
};
const content = () => ({ schemaVersion: 1, layers: [], messages: [], jobs: [], appliedJobs: [], video: {
  mode: "video", prompt: "镜头缓慢推进，保持商品细节", provider: "frames", duration: 5, ratio: "16:9", videoVariant: "hd", composition: null,
  media: [{ id: "first", type: "image", name: "开场图片", role: "first_frame" }, { id: "last", type: "image", name: "结束图片", role: "last_frame" }],
} });
async function setup(page, mode = "video") {
  const picture = await readFile(new URL("../../public/studio/scene-03.webp", import.meta.url));
  const doc = { id: "video-doc", name: "商品视频", version: 1, content: content() };
  if (mode === "motion") { doc.content.video.mode = mode; doc.content.video.media = []; }
  const state = { doc, jobs: [], submissions: [], canvasRequests: [], saves: [], errors: [] };
  page.on("pageerror", error => state.errors.push(error.message));
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const reply = json => route.fulfill({ json });
    if (path === "/api/auth/session") return reply({ user: { id: "upgrade-user", name: "Creator", credits: 100 }, expires: "2099-01-01" });
    if (path === "/api/auth/csrf") return reply({ csrfToken: "fixture" });
    if (path === "/api/video/capabilities") return reply(caps);
    if (path === "/api/creation/capabilities") return reply({ video: true, motion: true, launcherVisibility: { image: true, video: true, motion: true } });
    if (path === "/api/studio/capabilities") return reply({ imageProvider: "image", imageModels: [{ id: "image", label: "图片模型", creditCost: 18 }], tools: ["generate", "edit", "expand"].map(id => ({ id, available: true, cost: 18 })) });
    if (path === "/api/video/documents/video-doc") return reply(state.doc);
    if (path === "/api/video/canvas") { state.canvasRequests.push(request.postDataJSON()); return reply({ id: doc.id }); }
    if (path === "/api/studio/documents/canvas-doc") return reply({ id: "canvas-doc", name: "商品画布", version: 1, content: { schemaVersion: 1, messages: [], jobs: [], appliedJobs: [], layers: [{ id: "source", type: "image", assetId: "first", name: "开场图片", x: 100, y: 100, width: 400, height: 300, pixelWidth: 800, pixelHeight: 600, visible: true, opacity: 1 }] } });
    if (path.endsWith("/view")) return reply({ camera: { x: 0, y: 0, scale: 1 } });
    if (path === "/api/studio/documents" && request.method() === "POST") {
      const body = request.postDataJSON(); state.saves.push(body);
      const id = body.id || "video-doc", version = (body.version || 0) + 1;
      if (id === "video-doc") state.doc = { ...body, id, version };
      return reply({ id, version });
    }
    if (path === "/api/studio/jobs") {
      if (request.method() === "POST") {
        const body = request.postDataJSON(); state.submissions.push(body);
        const job = { id: "queued-video", documentId: body.documentId, tool: body.tool, status: "queued", createdAt: new Date().toISOString() };
        state.jobs = [job]; return reply(job);
      }
      return reply(url.searchParams.has("paged") ? { items: state.jobs, nextCursor: null } : state.jobs);
    }
    if (path.startsWith("/api/assets/")) return route.fulfill({ body: picture, contentType: "image/webp" });
    if (path === "/api/inspiration") return reply({ items: [], layout: { mode: "masonry", columns: 4, gap: 16 } });
    return reply({ items: [], credits: 100 });
  });
  return state;
}
async function capture(page, info, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

for (const [width, height] of [[1593, 819], [1705, 1000], [390, 844]]) {
  test(`video workspace keeps references, parameters and next draft at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    const state = await setup(page);
    await page.goto("/zh/video?document=video-doc");
    await expect(page.getByLabel("视频创意", { exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "前移 结束图片", exact: true }).click();
    await expect(page.locator(".vg-reference").first()).toContainText("结束图片");
    await expect(page.locator(".vg-reference").first()).toContainText("首帧");
    await page.getByRole("combobox", { name: "画幅", exact: true }).selectOption("9:16");
    await page.getByRole("combobox", { name: "时长", exact: true }).selectOption("10");
    await capture(page, info, "references-and-settings");
    await page.getByRole("button", { name: "开始生成", exact: true }).click();
    await expect(page.locator(".vm-job")).toContainText("等待开始");
    expect(state.submissions).toHaveLength(1);
    expect(state.submissions[0]).toMatchObject({ expectedCost: 20, params: { duration: 10, ratio: "9:16", videoVariant: "hd", media: [{ id: "last", role: "first_frame" }, { id: "first", role: "last_frame" }] } });
    await page.getByLabel("视频创意", { exact: true }).fill("准备下一版创意");
    await expect(page.getByRole("button", { name: "开始生成", exact: true })).toBeDisabled();
    await capture(page, info, "queued-with-next-draft");
    state.jobs[0] = { ...state.jobs[0], status: "failed", errorCode: "VIDEO_PROVIDER_FAILED" };
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator(".vm-job")).toContainText("执行失败");
    await expect(page.getByLabel("视频创意", { exact: true })).toHaveValue("准备下一版创意");
    await capture(page, info, "failed-with-preserved-draft");
    expect(state.errors).toEqual([]);
  });
}

test("homepage keeps independent image, video and motion drafts", async ({ page }, info) => {
  await page.setViewportSize({ width: 1593, height: 819 }); const state = await setup(page);
  await page.goto("/zh");
  await page.getByLabel("描述你的创意", { exact: true }).fill("图片创意保留");
  await page.getByRole("button", { name: "视频生成", exact: true }).click();
  await page.getByLabel("视频创意", { exact: true }).fill("视频创意保留");
  await page.locator(".cr-creation-settings summary").click();
  await expect(page.getByLabel("视频模型", { exact: true })).toBeEnabled();
  await capture(page, info, "home-video");
  await page.getByRole("button", { name: "视频制作", exact: true }).click();
  await page.getByLabel("视频创意", { exact: true }).fill("分镜制作创意");
  await capture(page, info, "home-motion");
  await page.getByRole("button", { name: "图片创作", exact: true }).click();
  await expect(page.getByLabel("描述你的创意", { exact: true })).toHaveValue("图片创意保留");
  await page.getByRole("button", { name: "视频生成", exact: true }).click();
  await expect(page.getByLabel("视频创意", { exact: true })).toHaveValue("视频创意保留");
  expect(state.submissions).toHaveLength(0); expect(state.errors).toEqual([]);
});

test("canvas image opens the shared video controls in a linked child document", async ({ page }, info) => {
  await page.setViewportSize({ width: 1705, height: 1000 }); const state = await setup(page);
  await page.goto("/zh/studio-v2?document=canvas-doc");
  await expect(page.getByRole("textbox", { name: "创作描述" })).toBeEnabled();
  const stage = page.locator(".ms-stage"); await expect(stage).toBeVisible();
  const box = await stage.boundingBox(), camera = JSON.parse(await stage.getAttribute("data-camera"));
  await page.mouse.click(box.x + camera.x + 300 * camera.scale, box.y + camera.y + 250 * camera.scale);
  await page.getByRole("group", { name: "图片工具" }).getByRole("button", { name: "生成视频", exact: true }).click();
  const panel = page.getByRole("region", { name: "生成视频", exact: true });
  await expect(panel.getByLabel("视频描述", { exact: true })).toBeEnabled();
  expect(state.canvasRequests).toEqual([{ documentId: "canvas-doc", layerId: "source" }]);
  await expect(panel.getByLabel("视频模型", { exact: true })).toHaveValue("frames");
  await expect(panel.getByRole("link", { name: "视频工作台", exact: true })).toHaveAttribute("href", /video\?document=video-doc$/);
  await capture(page, info, "canvas-video-controls");
  expect(state.errors).toEqual([]);
});

test("motion workspace supports a new editable composition", async ({ page }, info) => {
  await page.setViewportSize({ width: 1593, height: 819 }); const state = await setup(page, "motion");
  await page.goto("/zh/video?document=video-doc");
  await page.getByRole("button", { name: "新建空白动效工程", exact: true }).click();
  await expect.poll(() => state.saves.some(row => row.content.video.composition?.scenes?.length > 0)).toBe(true);
  await capture(page, info, "motion-composition");
  expect(state.errors).toEqual([]);
});
