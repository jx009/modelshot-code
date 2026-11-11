import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

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

test("browser provides real Chinese glyphs independently of application fonts", async ({ page, browser }, info) => {
  await page.setContent('<html lang="zh"><body><p id="cjk" style="font: 24px &quot;Noto Sans CJK SC&quot;, sans-serif">中文字体对照</p><p style="font: 24px sans-serif">中文字体对照</p></body></html>');
  const probe = await page.context().newCDPSession(page);
  await probe.send("DOM.enable"); await probe.send("CSS.enable");
  const { root: probeRoot } = await probe.send("DOM.getDocument");
  const { nodeId: probeId } = await probe.send("DOM.querySelector", { nodeId: probeRoot.nodeId, selector: "#cjk" });
  const initialFonts = await probe.send("CSS.getPlatformFontsForNode", { nodeId: probeId });
  await info.attach("initial-fonts", { body: JSON.stringify({ version: browser.version(), remote: Boolean(process.env.PW_TEST_CONNECT_WS_ENDPOINT), initialFonts }), contentType: "application/json" });
  await probe.detach();
  await capture(page, info, "system-chinese-fonts");
  if (process.platform === "linux" && process.env.CI) {
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
      const { root } = await cdp.send("DOM.getDocument");
      const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#cjk" });
      const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
      expect(fonts.some(font => font.familyName === "Noto Sans CJK SC" && font.glyphCount >= 6)).toBe(true);
    } finally { await cdp.detach(); }
  }
});
async function setup(page, mode = "video", sessionGate = Promise.resolve()) {
  const picture = await readFile(new URL("../../public/studio/scene-03.webp", import.meta.url));
  const doc = { id: "video-doc", name: "商品视频", version: 1, content: content() };
  if (mode === "motion") { doc.content.video.mode = mode; doc.content.video.media = []; }
  const state = { doc, jobs: [], submissions: [], canvasRequests: [], saves: [], errors: [] };
  page.on("pageerror", error => state.errors.push(error.message));
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const reply = json => route.fulfill({ json });
    if (path === "/api/auth/session") {
      await sessionGate;
      return reply({ user: { id: "upgrade-user", name: "Creator", credits: 100 }, expires: "2099-01-01" });
    }
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
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
    const { nodes } = await cdp.send("DOM.getFlattenedDocument", { depth: -1 });
    const samples = [], parents = new Set();
    for (const node of nodes.filter(node => node.nodeType === 3 && /[\u3400-\u9fff]/u.test(node.nodeValue))) {
      if (parents.has(node.parentId)) continue;
      parents.add(node.parentId);
      const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId: node.parentId });
      // Activity keeps inactive pages in the DOM. Only rendered text can tell
      // us which font supplied its glyphs; hidden nodes return an empty list.
      if (!fonts.length) continue;
      const { computedStyle } = await cdp.send("CSS.getComputedStyleForNode", { nodeId: node.parentId });
      samples.push({ text: node.nodeValue, fonts,
        style: computedStyle.filter(({ name }) => ["font-family", "font-size", "font-weight"].includes(name)) });
      if (samples.length === 12) break;
    }
    const path = info.outputPath(`${name}-fonts.json`);
    await writeFile(path, JSON.stringify(samples, null, 2));
    await info.attach(`${name}-fonts`, { path, contentType: "application/json" });
  } finally { await cdp.detach(); }
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
  await page.setViewportSize({ width: 1593, height: 819 });
  let releaseSession;
  const state = await setup(page, "video", new Promise(resolve => { releaseSession = resolve; }));
  await page.goto("/zh");
  await expect(page.getByLabel("描述你的创意", { exact: true })).toBeDisabled();
  releaseSession();
  await expect(page.getByLabel("描述你的创意", { exact: true })).toBeEnabled();
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

test("guest image prompt survives login while signed-in drafts stay account scoped", async ({ page }) => {
  const state = await setup(page);
  let user = null;
  await page.route("**/api/auth/session", route => route.fulfill({ json: user ? { user, expires: "2099-01-01" } : null }));
  await page.route("**/api/auth/providers", route => route.fulfill({ json: { email: { id: "email", type: "credentials" } } }));
  await page.route("**/api/auth/callback/email", route => {
    user = { id: "upgrade-user", name: "Creator", email: "creator@example.invalid", credits: 100 };
    return route.fulfill({ json: { url: "http://127.0.0.1:3101/zh" } });
  });
  await page.goto("/zh");
  const prompt = page.getByLabel("描述你的创意", { exact: true });
  await expect(prompt).toBeEnabled();
  await prompt.fill("登录后继续制作这张产品海报");
  await page.locator(".cr-top-cta").click();
  const dialog = page.getByRole("dialog", { name: "登录来塔绘梦" });
  await dialog.getByLabel("邮箱", { exact: true }).fill("creator@example.invalid");
  await dialog.getByLabel("密码", { exact: true }).fill("Fixture-password-123");
  await dialog.getByRole("button", { name: "登录", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(prompt).toHaveValue("登录后继续制作这张产品海报");
  await prompt.fill("账号 A 的私有草稿");
  user = { ...user, id: "second-account", name: "Second creator" };
  // The app deliberately disables focus refetch. Its online handler calls
  // useSession().update(), so wait for the new identity before checking drafts.
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/session");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  expect((await (await refreshed).json()).user.id).toBe("second-account");
  await expect(prompt).toHaveValue("");
  expect(state.submissions).toHaveLength(0);
  expect(state.errors).toEqual([]);
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

test("login callback opens the asset library without a second navigation", async ({ page }) => {
  const state = await setup(page);
  let signedIn = false;
  await page.route("**/api/auth/session", route => route.fulfill({ json: signedIn ? { user: { id: "library-user", name: "Creator", credits: 100 }, expires: "2099-01-01" } : null }));
  await page.route("**/api/auth/providers", route => route.fulfill({ json: { email: { id: "email", type: "credentials" } } }));
  await page.route("**/api/auth/callback/email", route => {
    signedIn = true;
    return route.fulfill({ json: { url: "http://127.0.0.1:3101/zh/assets" } });
  });
  await page.route("**/api/library/categories", route => route.fulfill({ json: [] }));
  await page.goto("/zh?auth=login&callbackUrl=%2Fzh%2Fassets");
  const dialog = page.getByRole("dialog", { name: "登录来塔绘梦" });
  await dialog.getByLabel("邮箱", { exact: true }).fill("creator@example.invalid");
  await dialog.getByLabel("密码", { exact: true }).fill("Fixture-password-123");
  await dialog.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/zh\/assets$/);
  await expect(page.getByRole("heading", { name: "我的素材", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "上传素材", exact: true })).toBeEnabled();
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
