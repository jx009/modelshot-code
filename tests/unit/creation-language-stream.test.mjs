import { beforeEach, expect, it, vi } from "vitest";
import { collectLanguageStream } from "../../src/lib/creation/language-stream.js";
import { invokeCreationLanguage } from "../../src/lib/domain/creation/language-provider.js";
import { languageFailureDiagnostic } from "../../src/lib/creation/language-failure.js";
import { AppError } from "../../src/lib/http.js";

const ports = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../../src/lib/domain/studio/providers.js", () => ({ imageClient: () => ({ chat: { completions: { create: ports.create } } }) }));
beforeEach(() => ports.create.mockReset());
const chunk = (content, finish_reason = null, extra = {}) => ({ choices: [{ index: 0, delta: { content, ...extra }, finish_reason }] });
const streamOf = chunks => ({ controller: { abort: vi.fn() }, async *[Symbol.asyncIterator]() { yield* chunks; } });
const options = extra => ({ startedAt: Date.now(), maxBytes: 1024, diagnostics: { chunksReceived: 0, contentBytes: 0 }, ...extra });
const config = { visionApiKey: "fixture", chatModel: "fixture" };
const request = purpose => ({ input: { purpose, sourceFormat: "html", prompt: "Launch", pageCount: 1 }, assets: [], images: [] });

it("assembles content deltas while ignoring reasoning and requires the successful finish marker", async () => {
  const s = streamOf([chunk(null, null, { reasoning_content: "PRIVATE" }), chunk('{"title":'), { choices: [], usage: {} }, chunk('"你好"}'), chunk(null, "stop")]);
  const opts = options();
  expect(await collectLanguageStream(s, opts)).toBe('{"title":"你好"}');
  expect(opts.diagnostics).toMatchObject({ chunksReceived: 5, contentBytes: Buffer.byteLength('{"title":"你好"}') });
  expect(opts.diagnostics.firstChunkMs).toBeGreaterThanOrEqual(0);
  expect(s.controller.abort).toHaveBeenCalledOnce();
});

it.each(["length", "content_filter", "tool_calls"])("rejects %s termination even if the prefix is valid JSON", async reason => {
  await expect(collectLanguageStream(streamOf([chunk('{}'), chunk(null, reason)]), options())).rejects.toThrow("LANGUAGE_RESULT_INCOMPLETE");
});

it("rejects early EOF, refusal, malformed chunks and oversized content", async () => {
  await expect(collectLanguageStream(streamOf([chunk('{}')]), options())).rejects.toThrow("LANGUAGE_STREAM_INTERRUPTED");
  await expect(collectLanguageStream(streamOf([chunk(null, null, { refusal: "No" })]), options())).rejects.toThrow("LANGUAGE_RESULT_INCOMPLETE");
  await expect(collectLanguageStream(streamOf([{ choices: [{ index: 1, delta: { content: '{}' }, finish_reason: "stop" }] }]), options())).rejects.toThrow("LANGUAGE_RESULT_INVALID");
  const oversized = streamOf([chunk('你好')]);
  await expect(collectLanguageStream(oversized, options({ maxBytes: 5 }))).rejects.toThrow("LANGUAGE_RESULT_TOO_LARGE");
  expect(oversized.controller.abort).toHaveBeenCalledOnce();
});

it("preserves cancellation when an SDK iterator silently exits on abort", async () => {
  const controller = new AbortController(), failure = new AppError("LANGUAGE_TIMEOUT", 504);
  const s = { controller: { abort: vi.fn() }, async *[Symbol.asyncIterator]() { yield chunk('{}'); controller.abort(failure); } };
  await expect(collectLanguageStream(s, options({ signal: controller.signal }))).rejects.toBe(failure);
  expect(s.controller.abort).toHaveBeenCalledOnce();
});

it("requests streaming only for slide pages and parses the complete JSON with one provider call", async () => {
  ports.create.mockResolvedValueOnce(streamOf([chunk('{"title":'), chunk('"Slide"}'), chunk(null, "stop")]));
  expect(await invokeCreationLanguage(config, request("slides.page"))).toEqual({ title: "Slide" });
  expect(ports.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ stream: true, model: "fixture", response_format: { type: "json_object" } }), expect.objectContaining({ timeout: 180000 }));
  ports.create.mockReset().mockResolvedValueOnce({ choices: [{ finish_reason: "stop", message: { content: '{"title":"Outline"}' } }] });
  expect(await invokeCreationLanguage(config, request("slides.outline"))).toEqual({ title: "Outline" });
  expect(ports.create.mock.calls[0][0].stream).toBeUndefined();
});

it("does not retry or downgrade a paid request after 524 and attaches bounded transport diagnostics", async () => {
  const failure = Object.assign(new Error("private upstream body"), { status: 524 });
  ports.create.mockRejectedValueOnce(failure);
  await expect(invokeCreationLanguage(config, request("slides.page"))).rejects.toBe(failure);
  expect(ports.create).toHaveBeenCalledOnce();
  const diagnostic = languageFailureDiagnostic(failure);
  expect(diagnostic).toMatchObject({ errorCode: "LANGUAGE_PROVIDER_GATEWAY_TIMEOUT", httpStatus: 524, requestMode: "stream", chunksReceived: 0 });
  expect(JSON.stringify(diagnostic)).not.toContain("private upstream body");
});

it("never returns partial JSON or silently issues a non-stream retry", async () => {
  ports.create.mockResolvedValueOnce(streamOf([chunk('{"title":"prefix"}') ]));
  await expect(invokeCreationLanguage(config, request("slides.page"))).rejects.toThrow("LANGUAGE_STREAM_INTERRUPTED");
  expect(ports.create).toHaveBeenCalledOnce();
  ports.create.mockReset().mockResolvedValueOnce({ choices: [] });
  await expect(invokeCreationLanguage(config, request("slides.page"))).rejects.toThrow("LANGUAGE_STREAM_UNSUPPORTED");
  expect(ports.create).toHaveBeenCalledOnce();
});
