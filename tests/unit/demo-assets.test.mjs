import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { demoAssetId, downloadVerifiedGarment, parseDemoSeedArguments } from "../../scripts/demo-assets-lib.mjs";

describe("demo asset seeding", () => {
  it("requires an account unless only verifying bundled files", () => {
    expect(parseDemoSeedArguments(["--user-email=Test@Example.com"])).toEqual({ userEmail: "test@example.com", verifyOnly: false });
    expect(parseDemoSeedArguments(["--verify-only"])).toEqual({ userEmail: "", verifyOnly: true });
    expect(() => parseDemoSeedArguments([])).toThrow("--user-email");
    expect(() => parseDemoSeedArguments(["--other"])).toThrow("Unknown argument");
  });

  it("creates a stable private asset id for each user", () => {
    expect(demoAssetId("user-a", "met-1")).toBe(demoAssetId("user-a", "met-1"));
    expect(demoAssetId("user-a", "met-1")).not.toBe(demoAssetId("user-b", "met-1"));
    expect(demoAssetId("user-a", "met-1")).toMatch(/^demo_[a-f0-9]{32}$/);
  });

  it("accepts only allowlisted image downloads with the recorded checksum", async () => {
    const bytes = Buffer.from("fixture-image");
    const entry = {
      id: "fixture",
      downloadUrl: "https://images.metmuseum.org/fixture.jpg",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const fetchImpl = vi.fn(async () => new Response(bytes, { headers: { "content-type": "image/jpeg" } }));
    await expect(downloadVerifiedGarment(entry, fetchImpl)).resolves.toMatchObject({ bytes, contentType: "image/jpeg" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    await expect(downloadVerifiedGarment({ ...entry, downloadUrl: "https://example.com/fixture.jpg" }, fetchImpl)).rejects.toThrow("not allowed");
    await expect(downloadVerifiedGarment({ ...entry, sha256: "0".repeat(64) }, fetchImpl)).rejects.toThrow("checksum mismatch");
  });
});
