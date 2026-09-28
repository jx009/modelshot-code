import http from "node:http";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { randomUUID } from "node:crypto";

// Only the isolated test database points to this loopback supplier.
const png = await sharp({ create: { width: 320, height: 480, channels: 3, background: "#42a79b" } }).png().toBuffer();
const layerRequests = new Map();
const supplier = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const payload = Buffer.concat(chunks), body = payload.toString();
  const dataURL = bytes => `data:image/png;base64,${bytes.toString("base64")}`;
  if (req.url.startsWith("/cloud/queue/fal-ai/qwen-image-layered")) {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST") {
      const input = JSON.parse(body), id = randomUUID();
      layerRequests.set(id, input);
      res.end(JSON.stringify({ request_id: id })); return;
    }
    const id = req.url.split("/requests/")[1]?.split("/")[0];
    if (!layerRequests.has(id)) { res.writeHead(404); res.end("{}"); return; }
    if (req.url.endsWith("/status")) { res.end(JSON.stringify({ status: "COMPLETED" })); return; }
    const source = Buffer.from(layerRequests.get(id).image_url.split(",")[1], "base64");
    const { width, height } = await sharp(source).metadata();
    const foreground = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp({ create: { width: 60, height: 60, channels: 4, background: "red" } }).png().toBuffer(), left: 60, top: 60 }]).png().toBuffer();
    res.end(JSON.stringify({ images: [{ url: dataURL(source) }, { url: dataURL(foreground) }] })); return;
  }
  if (req.url === "/cloud/api/v1/services/aigc/multimodal-generation/generation") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ output: { choices: [{ message: { content: [{ image: dataURL(png) }] } }] } })); return;
  }
  if (req.url === "/cloud/chat/completions") {
    const input = JSON.parse(body);
    if (input.model !== "fixture-language") { res.writeHead(422); res.end("{}"); return; }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "Fixture plan", steps: [{ tool: "generate", params: { prompt: "A product on a white background" }, explanation: "Create requested image" }] }) } }] })); return;
  }
  if (req.url === "/health") { res.end("ok"); return; }
  if (req.method === "GET" && req.url === "/capabilities") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ version: 1, tools: ["segment"] })); return;
  }
  if (req.method === "POST" && req.url === "/tools/segment") {
    const form = await new Response(payload, { headers: { "content-type": req.headers["content-type"] || "" } }).formData();
    const source = Buffer.from(await form.get("image").arrayBuffer());
    const selection = Buffer.from(await form.get("selection").arrayBuffer());
    const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const mask = await sharp(selection).greyscale().raw().toBuffer();
    const background = [data[0], data[1], data[2]];
    for (let pixel = 0; pixel < info.width * info.height; pixel++) {
      const offset = pixel * 4;
      const distance = Math.hypot(data[offset] - background[0], data[offset + 1] - background[1], data[offset + 2] - background[2]);
      data[offset + 3] = mask[pixel] > 127 && distance > 24 ? 255 : 0;
    }
    const result = await sharp(data, { raw: info }).png().toBuffer();
    res.writeHead(200, { "Content-Type": "image/png" }); res.end(result); return;
  }
  if (req.method === "POST" && req.url === "/worker/stop") {
    if (worker.exitCode === null) await new Promise(resolve => { worker.once("exit", resolve); worker.kill("SIGKILL"); });
    res.end("stopped"); return;
  }
  if (req.method === "POST" && req.url === "/worker/start") {
    if (worker.exitCode !== null || worker.signalCode) worker = startWorker();
    res.end("started"); return;
  }
  if (body.includes("FIXTURE_REJECT")) { res.writeHead(422, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { message: "Fixture rejection" } })); return; }
  await new Promise(resolve => setTimeout(resolve, body.includes("FIXTURE_DELAY") ? 5000 : body.includes("Remove ONLY this object") ? 3500 : 100));
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }));
});
await new Promise(resolve => supplier.listen(3199, "127.0.0.1", resolve));
const startWorker = () => spawn(process.execPath, ["src/workers/main.mjs"], { stdio: "inherit", env: process.env });
let worker = startWorker();
const web = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3100"], { stdio: "inherit", env: process.env });
function stop() { worker.kill(); web.kill(); supplier.close(); }
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
web.on("exit", code => { stop(); process.exitCode = code || 0; });
