import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { maskHash } from "../../src/lib/studio/mask-hash.js";

afterEach(() => vi.unstubAllGlobals());

describe("mask identity across HTTPS and HTTP browser contexts", () => {
  it.each(["", "abc", "遮罩 PNG bytes", "a".repeat(100000)])("matches the server SHA-256 with and without SubtleCrypto (%#. case)", async input => {
    const blob = new Blob([input]);
    const expected = createHash("sha256").update(input).digest("hex");
    vi.stubGlobal("crypto", webcrypto);
    expect(await maskHash(blob)).toBe(expected);
    vi.stubGlobal("crypto", { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
    expect(await maskHash(blob)).toBe(expected);
  });
  it("distinguishes two masks so the pending-submit signature cannot reuse the wrong selection", async () => {
    vi.stubGlobal("crypto", undefined);
    expect(await maskHash(new Blob([new Uint8Array([0, 255])]))).not.toBe(await maskHash(new Blob([new Uint8Array([255, 0])])));
  });
});
