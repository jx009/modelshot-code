import { expect, it, vi } from "vitest";
import { createPublicResourceCache } from "../../src/lib/creation/public-resource-cache.js";
import { importedParagraphs } from "../../src/lib/creation/office/protection.js";

it("deduplicates immutable reads, bounds concurrency and rejects excess pending reads", async () => {
  const read = createPublicResourceCache({ concurrency: 1, maxPending: 2 });
  let release; const load = vi.fn(() => new Promise(resolve => { release = resolve; }));
  const a = read("a", load), duplicate = read("a", load), bLoad = vi.fn(async () => Buffer.from("b")), b = read("b", bLoad);
  await Promise.resolve();
  expect(load).toHaveBeenCalledOnce(); expect(bLoad).not.toHaveBeenCalled();
  await expect(read("c", async () => Buffer.from("c"))).rejects.toThrow("WEB_PUBLICATION_BUSY");
  release(Buffer.from("a"));
  expect(await a).toEqual(await duplicate); expect(await b).toEqual(Buffer.from("b"));
  await read("a", load); expect(load).toHaveBeenCalledOnce();
});

it("expires/evicts entries and retries failures without caching them", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(0);
  try {
    const read = createPublicResourceCache({ maxBytes: 3, maxEntries: 1, ttl: 10 }), load = vi.fn(async () => Buffer.from("aa"));
    await read("a", load); await read("a", load); expect(load).toHaveBeenCalledTimes(1);
    now.mockReturnValue(11); await read("a", load); expect(load).toHaveBeenCalledTimes(2);
    await read("b", load); await read("a", load); expect(load).toHaveBeenCalledTimes(4);
    await expect(read("bad", async () => { throw new Error("checksum"); })).rejects.toThrow("checksum");
    await expect(read("bad", load)).resolves.toEqual(Buffer.from("aa"));
  } finally { now.mockRestore(); }
});

it("indexes long document paragraphs while preserving clipped runs and local ranges", () => {
  const count = 10000, dataStream = "abc\r".repeat(count);
  const paragraphs = Array.from({ length: count }, (_, i) => ({ paragraphId: `p${i}`, startIndex: i * 4 + 3 }));
  const textRuns = paragraphs.map((_, i) => ({ st: i * 4, ed: i * 4 + 3, ts: { bl: 1 } }));
  textRuns.push({ st: 2, ed: 6, ts: { it: 1 } });
  const result = importedParagraphs({ body: { dataStream, paragraphs, textRuns, customRanges: [{ startIndex: 4, endIndex: 5, properties: { url: "https://example.com" } }] } });
  expect(result.size).toBe(count);
  expect(result.get("p0").runs.at(-1)).toEqual({ st: 2, ed: 3, ts: { it: 1 } });
  expect(result.get("p1").runs.at(-1)).toEqual({ st: 0, ed: 2, ts: { it: 1 } });
  expect(result.get("p1").ranges[0]).toMatchObject({ startIndex: 0, endIndex: 1 });
  expect(result.get("p9999").text).toBe("abc");
});
