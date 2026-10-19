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
  it.each([['REGISTER', '注册'], ['RESET_PASSWORD', '重置密码']])("sends a Chinese %s subject and body", async (purpose, label) => {
    getSiteConfigs.mockResolvedValue({ smtp_host: "127.0.0.1", smtp_port: "51025", smtp_from: "noreply@modelshot.local" });
    await sendVerificationEmail("test@modelshot.local", "123456", purpose);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      subject: `【来塔绘梦】${label}验证码`,
      text: expect.stringContaining("123456"),
    }));
    const mail = sendMail.mock.calls.at(-1)[0];
    expect(mail.text).toContain("5 分钟内有效");
    expect(mail.text).toContain("如果这不是你本人的操作，请忽略此邮件");
    expect(mail.text).not.toContain("Your verification code");
  });
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
