import http from "node:http";
import { spawn } from "node:child_process";
import sharp from "sharp";

// Only the isolated test database points to this loopback supplier.
const png = await sharp({ create: { width: 320, height: 480, channels: 3, background: "#42a79b" } }).png().toBuffer();
const supplier = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString();
  if (req.url === "/health") { res.end("ok"); return; }
  if (req.method === "POST" && req.url === "/worker/stop") {
    if (worker.exitCode === null) await new Promise(resolve => { worker.once("exit", resolve); worker.kill("SIGKILL"); });
    res.end("stopped"); return;
  }
  if (req.method === "POST" && req.url === "/worker/start") {
    if (worker.exitCode !== null || worker.signalCode) worker = startWorker();
    res.end("started"); return;
  }
  if (body.includes("FIXTURE_REJECT")) { res.writeHead(422, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { message: "Fixture rejection" } })); return; }
  await new Promise(resolve => setTimeout(resolve, body.includes("FIXTURE_DELAY") ? 5000 : 100));
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
