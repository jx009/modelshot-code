import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSiteConfigs, sendMail, createTransport } = vi.hoisted(() => ({ getSiteConfigs: vi.fn(), sendMail: vi.fn(), createTransport: vi.fn() }));
vi.mock("../../src/lib/site-config", () => ({ getSiteConfigs }));
vi.mock("nodemailer", () => ({ default: { createTransport } }));
import { sendVerificationEmail } from "../../src/lib/email-service.js";

beforeEach(() => {
  getSiteConfigs.mockReset();
  createTransport.mockReturnValue({ sendMail });
  sendMail.mockResolvedValue({});
});

describe("verification email delivery", () => {
  it("rejects missing SMTP without logging or returning a code", async () => {
    getSiteConfigs.mockResolvedValue({});
    const log = vi.spyOn(console, "log");
    await expect(sendVerificationEmail("test@modelshot.local", "123456", "REGISTER")).rejects.toThrow("SMTP is not configured");
    expect(log).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });
  it("supports the local mail catcher without SMTP credentials", async () => {
    getSiteConfigs.mockResolvedValue({ smtp_host: "127.0.0.1", smtp_port: "51025", smtp_from: "noreply@modelshot.local" });
    expect(await sendVerificationEmail("test@modelshot.local", "123456", "REGISTER")).toEqual({ sent: true });
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ auth: undefined, secure: false, port: 51025 }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "test@modelshot.local" }));
  });
});
