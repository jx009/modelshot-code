import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("../../src/lib/prisma", () => ({ prisma: { user: { findUnique } } }));
vi.mock("../../src/lib/site-config", () => ({ getSiteConfigs: async () => ({}) }));
import { buildAuthOptions } from "../../src/lib/auth.js";

beforeEach(() => { findUnique.mockReset(); });

describe("identity and session baseline", () => {
  it("does not expose an API key login provider", async () => {
    expect((await buildAuthOptions()).providers.some(provider => provider.options?.id === "credentials")).toBe(false);
  });
  it("ignores client balance, role and credential updates", async () => {
    findUnique.mockResolvedValue({ credits: 18, role: "user", status: "active", sessionVersion: 0 });
    const { callbacks } = await buildAuthOptions();
    const token = await callbacks.jwt({
      token: { sub: "u1", sessionVersion: 0, customApiKey: "secret", isApiKeyUser: true },
      trigger: "update",
      session: { credits: 999999, role: "root", customApiKey: "injected" },
    });
    const session = await callbacks.session({ session: { user: {} }, token });
    expect(session.user).toEqual({ id: "u1", credits: 18, role: "user" });
    expect(token).not.toHaveProperty("customApiKey");
    expect(token).not.toHaveProperty("isApiKeyUser");
  });
  it.each([null, { status: "banned" }])("rejects absent or banned accounts", async account => {
    findUnique.mockResolvedValue(account);
    const { callbacks } = await buildAuthOptions();
    const token = await callbacks.jwt({ token: { sub: "u1", role: "root" } });
    expect((await callbacks.session({ session: { user: {} }, token })).user).toBeNull();
  });
  it("fails closed during database failure", async () => {
    findUnique.mockRejectedValue(new Error("database unavailable"));
    const { callbacks } = await buildAuthOptions();
    const token = await callbacks.jwt({ token: { sub: "u1", role: "root" } });
    expect((await callbacks.session({ session: { user: {} }, token })).user).toBeNull();
  });
  it("rejects old sessions after a password reset without refreshing their version", async () => {
    findUnique.mockResolvedValue({ credits: 18, role: "user", status: "active", sessionVersion: 2 });
    const { callbacks } = await buildAuthOptions();
    const token = await callbacks.jwt({ token: { id: "u1", sessionVersion: 1 }, trigger: "update", session: { sessionVersion: 2 } });
    expect(token.sessionVersion).toBe(1);
    expect((await callbacks.session({ session: { user: {} }, token })).user).toBeNull();
  });
});
