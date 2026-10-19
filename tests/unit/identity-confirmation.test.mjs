import { afterEach, expect, it, vi } from "vitest";

vi.mock("../../src/lib/domain/identity/rate-limit.js", () => ({ rateLimit: vi.fn() }));
vi.mock("../../src/lib/domain/identity/verification.js", async importOriginal => ({
  ...await importOriginal(), changeIdentity: vi.fn().mockResolvedValue({ ok: true }),
}));
import { changeIdentity } from "../../src/lib/domain/identity/verification.js";
import { POST as register } from "../../src/app/api/auth/email/register/route.js";
import { POST as reset } from "../../src/app/api/auth/email/reset-password/route.js";

afterEach(() => vi.unstubAllEnvs());
const input = { email: "creator@example.invalid", password: "Strong-password-123", code: "123456" };
function request(body) {
  vi.stubEnv("NEXTAUTH_URL", "https://example.invalid");
  return new Request("https://example.invalid/api/auth/email/register", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://example.invalid" }, body: JSON.stringify(body) });
}
for (const [purpose, post] of [["REGISTER", register], ["RESET_PASSWORD", reset]]) {
  it(`${purpose} rejects missing/mismatched confirmation before changing an account`, async () => {
    const missing = await post(request(input));
    expect(missing.status).toBe(400);
    const mismatch = await post(request({ ...input, confirmPassword: "Different-password-123" }));
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toMatchObject({ code: "PASSWORD_MISMATCH" });
    expect(changeIdentity).not.toHaveBeenCalled();
  });
  it(`${purpose} submits only matching passwords to the identity command`, async () => {
    expect((await post(request({ ...input, confirmPassword: input.password }))).status).toBe(200);
    expect(changeIdentity).toHaveBeenCalledWith(input, purpose);
  });
}
