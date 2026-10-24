import { Worker } from "node:worker_threads";
import { afterEach, expect, it, vi } from "vitest";
import { createWebSourceRunner } from "../../src/lib/creation/client/web-source-worker.js";
import { sourceTaskPayload, WEB_SOURCE_CHANNEL } from "../../src/lib/creation/web-source-protocol.js";
const fixture = new URL("../fixtures/creation-web-source-worker.mjs", import.meta.url);
const workers = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(workers.splice(0).map(worker => worker.terminate())); });
function actualWorker() {
  const worker = new Worker(fixture, { type: "module", resourceLimits: { maxOldGenerationSizeMb: 96 } }); workers.push(worker);
  const adapter = { postMessage: value => worker.postMessage(value), terminate: () => { void worker.terminate(); }, onmessage: null, onerror: null, onmessageerror: null };
  worker.on("message", data => adapter.onmessage?.({ data })); worker.on("error", error => adapter.onerror?.(error)); worker.on("messageerror", error => adapter.onmessageerror?.(error));
  return adapter;
}
function fakeFactory() {
  const created = [];
  const createWorker = vi.fn(() => { const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null, onmessageerror: null }; created.push(worker); return worker; });
  const respond = (index, extra = {}) => { const worker = created[index], sent = worker.postMessage.mock.lastCall[0]; worker.onmessage?.({ data: { channel: WEB_SOURCE_CHANNEL, type: sent.type, id: sent.id, ok: true, result: { source: sent.payload.source }, ...extra } }); };
  return { created, createWorker, respond };
}
const site = () => ({ entryPath: "index.html", files: [
  { id: "html", path: "index.html", kind: "html", content: '<h1>Coffee</h1><img src="image.webp">' },
  { id: "image", path: "image.webp", kind: "asset", assetId: "image-asset-123456" },
  { id: "css", path: "styles.css", kind: "css", content: 'p { background:url(image.webp) }' },
] });

it("executes visual parsing, static-reference rename and image insertion in real worker threads", async () => {
  const run = createWebSourceRunner({ createWorker: actualWorker });
  const visual = await run("visual", { source: "<h1>咖啡 &amp; Tea</h1>" });
  expect(visual.targets).toBeInstanceOf(Map); expect([...visual.targets.values()][0].text).toBe("咖啡 & Tea");
  expect(visual.marked).toContain('data-modelshot-edit-id="text-0"');
  const content = site();
  const rename = await run("rename", { content, request: { fileId: "image", path: "image.webp", nextPath: "assets/hero.webp" } });
  expect(rename.operations).toHaveLength(1); expect(rename.operations[0].updates).toHaveLength(2);
  expect(rename.operations[0].updates[0].content).toContain('src="assets/hero.webp"');
  const insert = await run("insertImage", { content, target: content.files[1], page: content.files[0] });
  expect(insert.operations[0].content).toContain('loading="lazy"'); expect(insert.selectedId).toBe("html");
});
it("returns source validation failures from the actual worker without evaluating generated script contents", async () => {
  const run = createWebSourceRunner({ createWorker: actualWorker });
  const visual = await run("visual", { source: '<script>while(true){};fetch("https://example.invalid")</script><p>Text</p>' });
  expect([...visual.targets.values()].map(target => target.text)).toEqual(["Text"]);
  await expect(run("visual", { source: '<p data-modelshot-edit-id="forged">Text</p>' })).rejects.toThrow("WEB_VISUAL_MARKER_RESERVED");
});
it("starts only one worker and bounds the pending queue, then releases workers and listeners on completion", async () => {
  const factory = fakeFactory(), run = createWebSourceRunner(factory);
  const first = run("visual", { source: "one" }), second = run("visual", { source: "two" }), third = run("visual", { source: "three" });
  await expect(run("visual", { source: "four" })).rejects.toThrow("WEB_SOURCE_WORKER_BUSY");
  expect(factory.createWorker).toHaveBeenCalledOnce(); factory.respond(0); expect(await first).toEqual({ source: "one" });
  expect(factory.created[0].terminate).toHaveBeenCalledOnce(); expect(factory.created[0].onmessage).toBeNull();
  factory.respond(1); await second; factory.respond(2); await third;
  expect(factory.createWorker).toHaveBeenCalledTimes(3); expect(factory.created.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true);
});
it("cancels queued work without spawning it and terminates active work even if it never responds", async () => {
  const factory = fakeFactory(), run = createWebSourceRunner(factory), one = new AbortController(), two = new AbortController();
  const first = run("visual", { source: "one" }, { signal: one.signal }), second = run("visual", { source: "two" }, { signal: two.signal });
  const rejectedOne = expect(first).rejects.toThrow("ARTIFACT_CLOSED"), rejectedTwo = expect(second).rejects.toThrow("ARTIFACT_CLOSED");
  const obsoleteCallback = factory.created[0].onmessage;
  two.abort(); one.abort(); await rejectedOne; await rejectedTwo;
  expect(factory.createWorker).toHaveBeenCalledOnce(); expect(factory.created[0].terminate).toHaveBeenCalledOnce();
  obsoleteCallback({ data: { channel: WEB_SOURCE_CHANNEL, id: 1, type: "visual", ok: true, result: "stale" } });
  expect(factory.created[0].terminate).toHaveBeenCalledOnce();
});
it("times out abandoned work, rejects startup/protocol errors, and permits subsequent requests", async () => {
  vi.useFakeTimers(); const factory = fakeFactory(), run = createWebSourceRunner({ ...factory, timeoutMs: 50 });
  const request = run("visual", { source: "timeout" }); const rejected = expect(request).rejects.toThrow("WEB_SOURCE_WORKER_TIMEOUT");
  await vi.advanceTimersByTimeAsync(51); await rejected; expect(factory.created[0].terminate).toHaveBeenCalledOnce();
  const next = run("visual", { source: "bad response" }), protocol = expect(next).rejects.toThrow("WEB_SOURCE_WORKER_PROTOCOL");
  factory.respond(1, { id: -1 }); await protocol;
  const last = run("visual", { source: "okay" }); factory.respond(2); await expect(last).resolves.toEqual({ source: "okay" });
  await expect(createWebSourceRunner({ createWorker: () => { throw new Error("Blocked by CSP"); } })("visual", { source: "x" })).rejects.toThrow("WEB_SOURCE_WORKER_UNAVAILABLE");
});
it("rejects oversized input before creating a worker and transfers only the source fields needed by each task", async () => {
  const factory = fakeFactory(), run = createWebSourceRunner(factory);
  await expect(run("visual", { source: "x".repeat(512 * 1024 + 1) })).rejects.toThrow("WEB_VISUAL_SOURCE_TOO_LARGE");
  expect(factory.createWorker).not.toHaveBeenCalled();
  const content = { ...site(), secret: "not part of worker data", files: [...site().files, { id: "js", path: "app.js", kind: "js", content: "Unneeded code", privateUrl: "private" }] };
  const renamed = sourceTaskPayload("rename", { content, request: { fileId: "js", path: "app.js", nextPath: "new.js", token: "ignored" } });
  expect(renamed.content).not.toHaveProperty("secret"); expect(renamed.request).not.toHaveProperty("token");
  expect(renamed.content.files[3]).toEqual({ id: "js", path: "app.js", kind: "js", content: "" });
  const insertion = sourceTaskPayload("insertImage", { content, target: content.files[1], page: content.files[0] });
  expect(insertion.content.files.map(file => file.id)).toEqual(["html", "image"]);
  const abort = new AbortController(); abort.abort(); await expect(run("visual", { source: "x" }, { signal: abort.signal })).rejects.toThrow("ARTIFACT_CLOSED");
  expect(factory.createWorker).not.toHaveBeenCalled();
});
