import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "../../src/lib/crypto.js";
import { availableProviders, providerAdapter } from "../../src/lib/domain/generation/providers.js";

afterEach(() => vi.unstubAllEnvs());

describe("platform provider configuration", () => {
  it("only exposes providers configured by an administrator", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "ab".repeat(32));
    const db = {
      modelProvider: {
        findMany: vi.fn().mockResolvedValue([
          { name: "openai", displayName: "OpenAI gateway", isDefault: true, priority: 0, config: JSON.stringify({ apiKeyEnc: encryptSecret("platform-key"), model: "gpt-image-2" }) },
          { name: "gemini", displayName: "Gemini", isDefault: false, priority: 1, config: "{}" },
        ]),
      },
    };

    const providers = await availableProviders("user-with-no-key", db);

    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatchObject({ id: "openai", platformConfigured: true, model: "gpt-image-2" });
    expect(db).not.toHaveProperty("providerCredential");
  });

  it("passes the administrator key, model and Base URL to the worker adapter", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "ab".repeat(32));
    const db = {
      modelProvider: {
        findUnique: vi.fn().mockResolvedValue({
          isActive: true,
          config: JSON.stringify({
            apiKeyEnc: encryptSecret("platform-key"),
            baseURL: "https://api.example.test/codex/images/edits",
          }),
        }),
      },
    };

    const adapter = await providerAdapter({ snapshot: { provider: "openai", model: "gpt-image-2" } }, db);

    expect(adapter.client.apiKey).toBe("platform-key");
    expect(adapter.client.baseURL).toBe("https://api.example.test/codex");
    expect(adapter.modelOverride).toBe("gpt-image-2");
  });
});
