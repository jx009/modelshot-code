import { chooseImageTool as tool } from "./helpers/image-tool.mjs";
import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { TOOLS } from "../../src/lib/studio/tool-catalog.js";
import { IMAGE_RATIOS } from "../../src/lib/studio/image-size.js";

async function fixture(page) {
  const png = await sharp({ create: { width: 600, height: 450, channels: 4, background: "#c6a67d" } }).png().toBuffer();
  let doc = { id: "creative-doc", version: 1, name: "创意测试", content: { schemaVersion: 1, layers: [0,1].map(i => ({ id:`layer-${i}`, type:"image", assetId:`image-${i}`, name:`参考图片 ${i+1}`, x:90+i*400,y:100,width:320,height:240,pixelWidth:600,pixelHeight:450,rotation:0,visible:true,opacity:1 })), messages:[],jobs:[],appliedJobs:[] } };
  const posted=[], errors=[], uploads=[], jobs=[];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/**", async route => {
    const request=route.request(), path=new URL(request.url()).pathname;
    const reply=data => route.fulfill({json:data});
    if(path.startsWith("/api/assets/")) return route.fulfill({body:png,contentType:"image/png"});
    if(path==="/api/auth/session") return reply({user:{id:"parity-user",name:"Creator",email:"parity@example.invalid",credits:500},expires:"2099-01-01"});
    if(path==="/api/inspiration") return reply({items:[],layout:{mode:"masonry",columns:4,gap:16}});
    if(path==="/api/studio/capabilities") return reply({imageProvider:"fixture",imageModels:[{id:"fixture",label:"Fixture image",maxReferenceImages:3,creditCost:18}],planningAvailable:true,planningCost:1,tools:TOOLS.map(tool => ({...tool,available:true}))});
    if(path==="/api/upload/direct") return reply({mode:"proxy"});
    if(path==="/api/upload") { uploads.push(request.postDataBuffer()); return reply({assetId:`uploaded-${uploads.length}`,width:600,height:450}); }
    if(path==="/api/studio/documents" && request.method()==="POST") { const body=request.postDataJSON(); doc={...doc,...body,id:"creative-doc",version:doc.version+1}; return reply(doc); }
    if(path==="/api/studio/documents/creative-doc") return reply(doc);
    if(path==="/api/studio/documents") return reply([]);
    if(path==="/api/studio/jobs" && request.method()==="POST") { const body=request.postDataJSON(); posted.push(body); const job={...body,id:`job-${posted.length}`,status:"queued",createdAt:new Date().toISOString()}; jobs.unshift(job); return reply(job); }
    if(path==="/api/studio/jobs") return reply(jobs);
    if(path==="/api/studio/focus") return reply({label:"玻璃瓶",languageCost:1});
    if(path==="/api/studio/cases") return reply({documentId:doc.id,mode:"quick"});
    return reply({credits:500,items:[]});
  });
  return {posted,errors,uploads,jobs,getDoc:()=>doc};
}
async function select(page,name="参考图片 1") {
  await page.getByRole("button",{name:"图层",exact:true}).click();
  await page.locator(".ms-layer-select").filter({hasText:name}).click();
  await page.getByRole("button",{name:"图层",exact:true}).click();
}

for (const width of [1440, 390]) test(`guided expansion uses the chosen geometry without language optimization at ${width}px`, async ({ page }, info) => {
  const f = await fixture(page);
  let languageRequests = 0;
  page.on("request", request => { if (/\/api\/studio\/(optimize|plan)$/.test(new URL(request.url()).pathname)) languageRequests++; });
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/zh/studio-v2?document=creative-doc");
  if (width < 760) await page.getByRole("button", { name: "画布", exact: true }).click();
  await select(page); await tool(page, "AI 扩图");
  const panel = page.locator(".ms-editor-expand");
  await panel.getByRole("button", { name: "16:9", exact: true }).click();
  await expect(panel).toContainText("800 × 450");
  await expect(panel.getByRole("checkbox")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`expansion-${width}.png`) });
  await panel.getByRole("button", { name: "生成 18 积分", exact: true }).click();
  await expect.poll(() => f.posted.length).toBe(1);
  expect(f.posted[0]).toMatchObject({ tool: "expand", params: { padding: { left: 100, right: 100, top: 0, bottom: 0 } } });
  expect(f.posted[0].params.autoOptimize).toBeUndefined();
  expect(languageRequests).toBe(0);
  expect(f.errors).toEqual([]);
});

for (const width of [1440, 390]) test(`OCR result has direct entry points and persistent controls at ${width}px`, async ({ page, context }, info) => {
  const f = await fixture(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const boxes = Array.from({ length: 45 }, (_, index) => ({ text: `识别文字 ${index + 1}`, rect: index ? null : { left: 10, top: 10, width: 100, height: 20 } }));
  const job = { id: "ocr-result-job", tool: "ocr", status: "succeeded", documentId: "creative-doc", targetId: "layer-0", resultData: { ocr: { boxes, approximateLocations: true } } };
  await page.route("**/api/studio/jobs?**", route => route.fulfill({ json: [job] }));
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/zh/studio-v2?document=creative-doc");
  if (width < 760) await page.getByRole("button", { name: "画布", exact: true }).click();
  const entry = page.getByRole("button", { name: "查看文字 · 参考图片 1", exact: true });
  await expect(entry).toBeVisible();
  await expect(page.locator(".ms-message")).toHaveCount(0);
  await entry.click();
  const panel = page.getByRole("dialog", { name: "图片中的文字", exact: true });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("识别到 45 段文字");
  const close = panel.getByRole("button", { name: "关闭文字识别结果", exact: true });
  const before = await close.boundingBox();
  await panel.locator(".ms-ocr-content").evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(panel.getByLabel("第 45 段文字", { exact: true })).toBeInViewport();
  await expect(close).toBeInViewport();
  expect((await close.boundingBox()).y).toBeCloseTo(before.y, 1);
  await panel.getByRole("button", { name: "复制全部文字", exact: true }).click();
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(boxes.map(box => box.text).join("\n"));
  await expect(panel.getByRole("button", { name: "已复制", exact: true })).toBeVisible();
  if (width === 390) {
    // Remote HTTP origins have no Clipboard API; selection copying must still work.
    await page.evaluate(async () => {
      await navigator.clipboard.writeText("previous clipboard");
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    });
    await panel.getByRole("button", { name: "已复制", exact: true }).click();
    const copied = await page.evaluate(() => { delete navigator.clipboard; return navigator.clipboard.readText(); });
    expect(copied.replace(/\r\n/g, "\n")).toBe(boxes.map(box => box.text).join("\n"));
    await expect(panel.getByLabel("第 45 段文字", { exact: true })).toBeInViewport();
  }
  await page.screenshot({ path: info.outputPath(`ocr-scrolled-${width}.png`) });
  await close.click();
  await expect(panel).toHaveCount(0);
  // The restored canvas task center remains available; OCR opens independently.
  await expect(page.getByRole("button", { name: "任务列表", exact: true })).toHaveCount(1);
  await entry.click();
  await expect(panel).toBeVisible();
  await expect(page.locator(".ms-task-popover")).toHaveCount(0);
  await panel.getByLabel("第 1 段文字", { exact: true }).fill("修订文字");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  expect(f.posted).toHaveLength(0);
  expect(f.errors).toEqual([]);
});

for (const width of [1440,390]) test(`ratio grid sends wide 4K and persists in the canvas at ${width}px`,async({page},info)=>{
  const f=await fixture(page);
  await page.setViewportSize({width,height:960});
  await page.goto("/zh");
  await expect(page.getByRole("button",{name:/生图模型：Fixture image/})).toBeVisible();
  await page.getByRole("button",{name:"图片比例",exact:true}).click();
  const panel=page.getByRole("dialog",{name:"比例与分辨率",exact:true});
  for (const ratio of IMAGE_RATIOS) {
    const button=panel.getByRole("button",{name:ratio==="auto"?"智能":ratio,exact:true});
    await button.click(); await expect(button).toHaveAttribute("aria-pressed","true");
  }
  await panel.getByRole("button",{name:"4K",exact:true}).click();
  await expect(panel).toContainText("8192 × 1024 px");
  const box=await panel.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x+box.width).toBeLessThanOrEqual(width);
  await page.screenshot({path:info.outputPath(`ratio-picker-${width}.png`)});
  await panel.getByRole("button",{name:"完成",exact:true}).click();
  const trigger=page.getByRole("button",{name:"图片比例",exact:true});
  await expect(trigger).toContainText("8:1"); await expect(trigger).toContainText("4K");
  await page.getByLabel("描述你的创意").fill("全景产品海报");
  await page.getByLabel("描述你的创意").press("Enter");
  await expect(page).toHaveURL(/studio-v2\?document=/);
  expect(f.posted).toHaveLength(1); expect(f.posted[0].params.size).toBe("8:1@4K");
  await expect(page.getByLabel("创作描述",{exact:true})).toBeEnabled();
  await expect(trigger).toContainText("8:1");
  await trigger.click();
  await panel.getByRole("button",{name:"9:16",exact:true}).click();
  await panel.getByRole("button",{name:"2K",exact:true}).click();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0); await expect(trigger).toBeFocused();
  await expect.poll(()=>f.getDoc().content.composer.size).toBe("9:16@2K");
  await page.reload(); await expect(trigger).toContainText("9:16"); await expect(trigger).toContainText("2K");
  expect(f.errors).toEqual([]);
});

test("homepage retains references and submits chosen ratio, fixed prompt and batch",async({page})=>{
  const f=await fixture(page);
  await page.goto("/zh");
  await expect(page.getByRole("button",{name:/生图模型：Fixture image/})).toBeVisible();
  await expect(page.getByLabel("上传参考图片")).toHaveCount(1);
  await page.getByLabel("上传参考图片").setInputFiles("public/inspiration/chair.webp");
  await expect(page.locator(".cr-attachments img")).toHaveCount(1);
  await expect(page).toHaveURL(/\/zh$/);
  await page.getByLabel("描述你的创意").fill("自然光商品海报");
  await page.getByLabel("设置固定提示词").click();
  await page.getByLabel("固定提示词",{exact:true}).fill("保留产品外观");
  await page.getByRole("button",{name:"图片比例",exact:true}).click();
  await page.getByRole("dialog",{name:"比例与分辨率"}).getByRole("button",{name:"2:3",exact:true}).click();
  await page.getByRole("button",{name:"完成",exact:true}).click();
  await page.getByLabel("生成张数").selectOption("2");
  await page.getByLabel("开始创作",{exact:true}).click();
  await expect(page).toHaveURL(/studio-v2\?document=/);
  expect(f.posted).toHaveLength(2);
  expect(f.posted[0]).toMatchObject({tool:"edit",assetId:"uploaded-1",params:{prompt:"保留产品外观\n自然光商品海报",size:"2:3@1K"}});
  await expect(page.locator(".ms-message.user")).toHaveText("自然光商品海报");
  await expect(page.locator(".ms-message.user img")).toHaveCount(1);
  await expect(page.getByLabel("创作描述", {exact:true})).toHaveValue("");
  await expect(page.locator(".ms-task-status > div")).toHaveCount(2);
  expect(f.getDoc().content.composer.fixedPrompt).toBe("保留产品外观");
  expect(f.errors).toEqual([]);
});
for (const mode of ["对话"]) test(`homepage ${mode} Enter submits once without another canvas confirmation`,async({page})=>{
  const f=await fixture(page);
  let release, creations=0;
  const gate=new Promise(resolve=>{release=resolve;});
  await page.route("**/api/studio/documents",async route=>{
    if(route.request().method()==="POST") { creations++; await gate; }
    await route.fallback();
  });
  try {
    await page.goto("/zh");
    await expect(page.getByRole("button",{name:/生图模型：Fixture image/})).toBeVisible();
    await page.getByRole("tab",{name:mode,exact:true}).click();
    const prompt=page.getByLabel("描述你的创意");
    await prompt.press("Enter"); expect(creations).toBe(0);
    await prompt.fill("自然光商品海报");
    await prompt.press("Shift+Enter");
    await expect(prompt).toHaveValue("自然光商品海报\n");
    await prompt.dispatchEvent("keydown",{key:"Enter",code:"Enter",isComposing:true});
    await prompt.dispatchEvent("keydown",{key:"Enter",code:"Enter",keyCode:229});
    await prompt.dispatchEvent("keydown",{key:"Enter",code:"Enter",repeat:true});
    expect(creations).toBe(0); expect(f.posted).toHaveLength(0);
    await prompt.fill("自然光商品海报");
    await prompt.press("Enter");
    await expect.poll(()=>creations).toBe(1);
    // A second physical press while the first submission is waiting must not
    // create another document, batch or paid request.
    await prompt.press("Enter");
    expect(creations).toBe(1);
    release();
    await expect(page).toHaveURL(/studio-v2\?document=/);
    await expect(page.getByLabel("创作描述",{exact:true})).toBeEnabled();
    expect(f.posted).toHaveLength(1);
    expect(f.posted[0]).toMatchObject({tool:"generate",params:{prompt:"自然光商品海报",size:"1024x1024"}});
    await expect(page.locator(".ms-message.user")).toHaveText("自然光商品海报");
    await expect(page.locator(".ms-welcome")).toHaveCount(0);
    await expect(page.getByLabel("创作描述",{exact:true})).toHaveValue("");
    await expect(page.locator(".ms-task-status")).toContainText("排队中");
    await page.reload();
    await expect(page.locator(".ms-message.user")).toHaveText("自然光商品海报");
    await expect(page.getByLabel("创作描述",{exact:true})).toHaveValue("");
    await expect(page.locator(".ms-task-status")).toContainText("排队中");
    expect(f.posted).toHaveLength(1);
    expect(f.errors).toEqual([]);
  } finally {release();}
});

test("homepage batch retry preserves one message and reuses the uncertain job key", async ({page}) => {
  const f = await fixture(page);
  const keys = [];
  await page.route("**/api/studio/jobs", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    keys.push(route.request().headers()["idempotency-key"]);
    if (keys.length === 2) return route.fulfill({status:503,json:{code:"TEMPORARILY_UNAVAILABLE"}});
    return route.fallback();
  });
  await page.goto("/zh");
  await expect(page.getByRole("button", {name:/生图模型：Fixture image/})).toBeVisible();
  await page.getByLabel("描述你的创意").fill("画一只狮子");
  await page.getByLabel("生成张数").selectOption("2");
  await page.getByLabel("开始创作", {exact:true}).click();
  await expect(page.locator(".cr-home-composer [role=alert]")).toContainText("TEMPORARILY_UNAVAILABLE");
  expect(f.posted).toHaveLength(1);
  await page.getByLabel("开始创作", {exact:true}).click();
  await expect(page).toHaveURL(/studio-v2\?document=/);
  await expect(page.locator(".ms-message.user")).toHaveText("画一只狮子");
  await expect(page.getByLabel("创作描述", {exact:true})).toHaveValue("");
  await expect(page.locator(".ms-task-status > div")).toHaveCount(2);
  expect(keys).toHaveLength(3);
  expect(keys[2]).toBe(keys[1]);
  expect(keys[0]).not.toBe(keys[1]);
  expect(f.posted).toHaveLength(2);
  expect(f.getDoc().content.messages).toHaveLength(1);
  expect(f.errors).toEqual([]);
});

test("homepage results stay in chat while task progress stays on the canvas", async ({page}, info) => {
  const f = await fixture(page);
  await page.goto("/zh");
  await expect(page.getByRole("button", {name:/生图模型：Fixture image/})).toBeVisible();
  await page.getByLabel("描述你的创意").fill("画一只狮子");
  await page.getByLabel("描述你的创意").press("Enter");
  await expect(page.locator(".ms-task-status")).toContainText("排队中");
  await page.screenshot({path:info.outputPath("homepage-chat-queued.png")});
  f.jobs[0].status = "running";
  f.jobs.push({id:"canvas-only",documentId:"creative-doc",origin:"canvas",tool:"expand",status:"queued"});
  await expect(page.locator(".ms-task-status")).toContainText("正在处理");
  await expect(page.locator(".ms-task-status > div")).toHaveCount(2);
  await expect(page.locator(".ms-conversation")).not.toContainText("扩图");
  await expect(page.locator(".ms-chat-activity")).toHaveCount(0);
  f.jobs[0].status = "succeeded";
  f.jobs[0].resultData = {assets:[{id:"lion-result",width:600,height:450,contentType:"image/png"}]};
  await expect(page.locator(".ms-message.assistant img")).toHaveCount(1);
  await expect(page.locator(".ms-task-status > div")).toHaveCount(1);
  await expect.poll(() => f.getDoc().content.appliedJobs).toContain("job-1");
  await page.reload();
  await expect(page.locator(".ms-message.user")).toHaveCount(1);
  await expect(page.locator(".ms-message.assistant")).toHaveCount(1);
  expect(f.posted).toHaveLength(1);
  f.jobs.push({id:"failed-chat",documentId:"creative-doc",origin:"chat",tool:"generate",status:"failed",errorCode:"PROVIDER_REJECTED",createdAt:new Date(Date.now() + 1000).toISOString()});
  await expect(page.locator(".ms-task-status")).toContainText("生成图片");
  await expect(page.locator(".ms-task-status").getByRole("button", {name:"关闭失败提示"})).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("homepage Enter waits for pricing and submits once when model loading is slow",async({page})=>{
  const f=await fixture(page);
  let release, pricingRequests=0;
  const gate=new Promise(resolve=>{release=resolve;});
  await page.route("**/api/studio/capabilities",async route=>{
    pricingRequests++;
    await gate;
    return route.fulfill({json:{imageProvider:"slow-model",imageModels:[{id:"slow-model",label:"Slow model",creditCost:9,resolutionSurcharges:{"1K":0,"2K":8,"4K":22}}],tools:[]}});
  });
  try {
    await page.goto("/zh");
    await expect.poll(()=>pricingRequests).toBe(1);
    await expect(page.locator(".cr-send .generation-price")).toHaveText("—");
    const prompt=page.getByLabel("描述你的创意");
    await prompt.fill("自然光商品海报");
    await prompt.press("Enter");
    await expect.poll(()=>pricingRequests).toBe(2);
    expect(f.posted).toHaveLength(0);
    await prompt.press("Enter");
    release();
    await expect(page).toHaveURL(/studio-v2\?document=/);
    expect(f.posted).toHaveLength(1);
    expect(f.posted[0]).toMatchObject({expectedCost:9,provider:"slow-model",params:{size:"1024x1024"}});
    expect(f.errors).toEqual([]);
  } finally {release();}
});

test("homepage quotes the routed edit model when references are attached",async({page})=>{
  const f=await fixture(page);
  await page.route("**/api/studio/capabilities",route=>route.fulfill({json:{
    imageProvider:"fixture",imageModels:[{id:"fixture",label:"Fixture image",creditCost:18,maxReferenceImages:3}],
    tools:[{id:"generate",cost:7,resolutionSurcharges:{"1K":0,"2K":11,"4K":33}},
      {id:"edit",cost:11,resolutionSurcharges:{"1K":0,"2K":11,"4K":33}}],
  }}));
  await page.goto("/zh");
  await expect(page.locator(".cr-send .generation-price")).toHaveText("7");
  await page.getByLabel("上传参考图片").setInputFiles("public/inspiration/chair.webp");
  await expect(page.locator(".cr-send .generation-price")).toHaveText("11");
  await page.getByRole("button",{name:"图片比例",exact:true}).click();
  await page.getByRole("button",{name:"2K",exact:true}).click();
  await page.getByRole("button",{name:"完成",exact:true}).click();
  await expect(page.locator(".cr-send .generation-price")).toHaveText("22");
  await page.getByLabel("描述你的创意").fill("自然光商品海报");
  await page.getByLabel("开始创作",{exact:true}).click();
  await expect(page).toHaveURL(/studio-v2\?document=/);
  expect(f.posted).toHaveLength(1);
  expect(f.posted[0]).toMatchObject({tool:"edit",expectedCost:22,params:{size:"1:1@2K"}});
  expect(f.errors).toEqual([]);
});

test("focus points, explicit identification, translation and blend submit real parameters",async({page})=>{
  const f=await fixture(page);
  await page.goto("/zh/studio-v2?document=creative-doc");
  await select(page); await tool(page,"焦点编辑");
  const stage=page.locator(".ms-stage");
  await expect(stage).toHaveAttribute("data-mode","focus");
  const box=await stage.boundingBox();
  const frame=JSON.parse(await stage.getAttribute("data-selection-frame"));
  await page.mouse.click(box.x+frame.left+frame.width*.35,box.y+frame.top+frame.height*.15);
  await expect(page.getByLabel("焦点1",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"识别 · 1",exact:true}).click();
  await expect(page.getByLabel("焦点1",{exact:true})).toHaveValue("玻璃瓶");
  await page.getByLabel("工具提示词").fill("把 @1 改为蓝色");
  await page.getByRole("button",{name:"生成 18 积分",exact:true}).click();
  await expect.poll(()=>f.posted.length).toBe(1);
  expect(f.posted[0].params.focusPoints[0]).toMatchObject({label:"玻璃瓶"});
  expect(f.posted[0].params.focusPoints[0]).not.toHaveProperty("loading");
  await tool(page,"图片翻译"); await page.getByLabel("翻译语言").selectOption("ja");
  await page.getByRole("button",{name:"生成 18 积分",exact:true}).click();
  await expect.poll(()=>f.posted.length).toBe(2); expect(f.posted[1].params.language).toBe("ja");
  await tool(page,"多图融合"); await page.getByRole("button",{name:"参考参考图片 2",exact:true}).click();
  await page.getByLabel("工具提示词").fill("采用第二张图片的场景");
  await page.getByRole("button",{name:"生成 18 积分",exact:true}).click();
  await expect.poll(()=>f.posted.length).toBe(3); expect(f.posted[2].referenceAssetIds).toEqual(["image-1"]);
  expect(f.errors).toEqual([]);
});
test("local color creates a reusable derivative and retains original; grouping and locks persist",async({page},info)=>{
  const f=await fixture(page);
  await page.goto("/zh/studio-v2?document=creative-doc"); await select(page); await tool(page,"调色");
  await page.getByRole("button",{name:"胶片",exact:true}).click();
  await expect(page.getByLabel("饱和度",{exact:true})).toHaveValue("-15");
  await page.screenshot({path:info.outputPath("color-panel.png")});
  await page.getByRole("button",{name:"应用",exact:true}).click();
  await expect(page.locator(".ms-adjustment-panel")).toHaveCount(0);
  await page.getByRole("button",{name:"保存",exact:true}).click();
  await expect.poll(()=>f.getDoc().content.layers.length).toBe(3);
  expect(f.getDoc().content.layers[0].assetId).toBe("image-0");
  expect(f.getDoc().content.layers[2].assetId).toBe("uploaded-1"); expect(f.posted).toHaveLength(0);
  await page.getByRole("button",{name:"图层",exact:true}).click();
  await page.locator(".ms-layer-select").filter({hasText:/^参考图片 1$/}).click();
  await page.locator(".ms-layer-select").filter({hasText:/^参考图片 2$/}).click({modifiers:["Shift"]});
  await page.getByRole("button",{name:"组合",exact:true}).click();
  await page.getByLabel("对齐图层").selectOption("top");
  await page.getByRole("button",{name:"锁定",exact:true}).click();
  await page.getByRole("button",{name:"保存",exact:true}).click();
  await expect.poll(()=>f.getDoc().content.layers[0].locked).toBe(true);
  expect(f.getDoc().content.layers[0].selectionGroup).toBe(f.getDoc().content.layers[1].selectionGroup);
  expect(f.errors).toEqual([]);
});
test("case recipe opens a configured canvas document",async({page})=>{
  const f=await fixture(page);
  await page.goto("/zh/explore/quiet-living");
  await page.getByRole("button",{name:"以此创作",exact:true}).click();
  await expect(page).toHaveURL(/studio-v2\?document=creative-doc&mode=quick/);
  expect(f.errors).toEqual([]);
});

test("marquee, group transformation, context duplication and undo preserve the selection",async({page})=>{
  const f=await fixture(page);
  await page.setViewportSize({width:1440,height:960});
  await page.goto("/zh/studio-v2?document=creative-doc");
  await expect(page.getByLabel("创作描述",{exact:true})).toBeEnabled();
  const stage=page.locator(".ms-stage");
  const box=await stage.boundingBox(), camera=JSON.parse(await stage.getAttribute("data-camera"));
  const screen=(x,y)=>({x:box.x+camera.x+x*camera.scale,y:box.y+camera.y+y*camera.scale});
  const a=screen(65,80), b=screen(835,365);
  await page.mouse.move(a.x,a.y); await page.mouse.down(); await page.mouse.move(b.x,b.y,{steps:12}); await page.mouse.up();
  await expect(page.locator(".ms-selection-tools")).toContainText("2 个图层");
  await expect(page.getByRole("group",{name:"图片工具",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"组合",exact:true}).click();
  const dragStart=screen(250,220);
  await page.mouse.move(dragStart.x,dragStart.y); await page.mouse.down(); await page.mouse.move(dragStart.x+25,dragStart.y+12,{steps:8}); await page.mouse.up();
  await page.getByRole("button",{name:"保存",exact:true}).click();
  await expect.poll(()=>f.getDoc().content.layers[0].x).toBeGreaterThan(100);
  expect(f.getDoc().content.layers[1].x-f.getDoc().content.layers[0].x).toBeCloseTo(400,2);
  // A joint drag should create one undo entry, not one entry for each node.
  await page.keyboard.press("Control+z");
  await page.getByRole("button",{name:"保存",exact:true}).click();
  await expect.poll(()=>f.getDoc().content.layers[0].x).toBe(90);
  expect(f.getDoc().content.layers[1].x).toBe(490);
  // The shared bottom-right corner scales both layers around one origin.
  const corner=screen(814,344);
  await page.mouse.move(corner.x,corner.y); await page.mouse.down(); await page.mouse.move(corner.x+45,corner.y+20,{steps:12}); await page.mouse.up();
  await page.getByRole("button",{name:"保存",exact:true}).click();
  await expect.poll(()=>f.getDoc().content.layers[0].width).toBeGreaterThan(330);
  const transformed=f.getDoc().content.layers;
  expect(transformed[0].width).toBeCloseTo(transformed[1].width,2);
  expect(transformed[1].x-transformed[0].x).toBeCloseTo(400*transformed[0].width/320,1);
  // Rotate the shared handle 90 degrees, preserving distance and layer angles.
  const bounds=await stage.evaluate(element=>{
    const c=JSON.parse(element.dataset.camera); return {x:element.getBoundingClientRect().x,y:element.getBoundingClientRect().y,c};
  });
  const centerX=(transformed[0].x+transformed[1].x+transformed[1].width)/2;
  const centerY=transformed[0].y+transformed[0].height/2;
  const sx=bounds.x+bounds.c.x+centerX*bounds.c.scale;
  const sy=bounds.y+bounds.c.y+centerY*bounds.c.scale;
  const handleY=bounds.y+bounds.c.y+transformed[0].y*bounds.c.scale-54;
  await page.mouse.move(sx,handleY); await page.mouse.down(); await page.mouse.move(sx+(sy-handleY),sy,{steps:15}); await page.mouse.up();
  await page.getByRole("button",{name:"保存",exact:true}).click();
  await expect.poll(()=>Math.abs(f.getDoc().content.layers[0].rotation)).toBeGreaterThan(45);
  expect(f.getDoc().content.layers[0].rotation).toBeCloseTo(f.getDoc().content.layers[1].rotation,1);
  const rotated=f.getDoc().content.layers[1];
  const angle=rotated.rotation*Math.PI/180;
  const inside=screen(rotated.x+rotated.width/2*Math.cos(angle)-rotated.height/2*Math.sin(angle),rotated.y+rotated.width/2*Math.sin(angle)+rotated.height/2*Math.cos(angle));
  await page.mouse.click(inside.x,inside.y,{button:"right"});
  await page.getByRole("menuitem",{name:"复制",exact:true}).click();
  await page.getByRole("button",{name:"保存",exact:true}).click();
  await expect.poll(()=>f.getDoc().content.layers.length).toBe(4);
  const copies=f.getDoc().content.layers.slice(2);
  expect(copies[0].selectionGroup).toBe(copies[1].selectionGroup);
  expect(copies[0].selectionGroup).not.toBe(transformed[0].selectionGroup);
  await page.keyboard.press("Control+z");
  await page.getByRole("button",{name:"保存",exact:true}).click();
  await expect.poll(()=>f.getDoc().content.layers.length).toBe(2);
  expect(f.errors).toEqual([]);
});

test("guest prompt is editable after session resolution and cannot submit a paid job",async({page})=>{
  const f=await fixture(page);
  await page.route("**/api/auth/session",route=>route.fulfill({json:{}}));
  await page.goto("/zh/studio-v2?prompt=guest%20idea");
  const prompt=page.getByLabel("创作描述",{exact:true});
  await expect(prompt).toBeEnabled(); await expect(prompt).toHaveValue("guest idea");
  await prompt.fill("柔和光线的产品海报");
  await page.getByRole("button",{name:"生成 · 18 积分",exact:true}).click();
  await expect(page.getByText("请先登录，素材和作品会保存到你的账户。",{exact:true})).toBeVisible();
  expect(f.posted).toHaveLength(0);
});

for (const width of [1440, 390]) test(`grouped image tools hover and keyboard at ${width}px`, async ({ page }, info) => {
  const f = await fixture(page);
  await page.setViewportSize({ width, height: 960 });
  await page.goto("/zh/studio-v2?document=creative-doc");
  if (width < 760) await page.getByRole("button", { name: "画布", exact: true }).click();
  await select(page);
  const toolbar = page.getByRole("group", { name: "图片工具", exact: true });
  await expect(toolbar.locator(".ms-context-scroll>button")).toHaveCount(8);
  const box = await toolbar.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(box.height).toBeLessThan(140);
  const prompts = toolbar.getByRole("button", { name: "反推提示词", exact: true });
  await prompts.hover();
  const menu = page.getByRole("menu", { name: "反推提示词", exact: true });
  await expect(menu).toBeVisible();
  const recipe = menu.getByRole("menuitem", { name: "提取风格配方", exact: true });
  await recipe.hover(); await page.waitForTimeout(250);
  await expect(menu).toBeVisible();
  await page.screenshot({ path: info.outputPath(`grouped-toolbar-${width}.png`) });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0); await expect(prompts).toBeFocused();
  await prompts.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "反推提示词", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown"); await expect(recipe).toBeFocused();
  await page.keyboard.press("Escape");
  await toolbar.getByRole("button", { name: "文字编辑", exact: true }).dispatchEvent("click");
  const text = page.getByRole("menu", { name: "文字编辑", exact: true });
  await expect(text.getByRole("menuitem")).toHaveCount(3);
  const menuBox = await text.boundingBox();
  expect(menuBox.x).toBeGreaterThanOrEqual(0); expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);
  await text.getByRole("menuitem", { name: "图片翻译", exact: true }).click();
  await expect(page.getByLabel("翻译语言")).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect(f.errors).toEqual([]);
});
