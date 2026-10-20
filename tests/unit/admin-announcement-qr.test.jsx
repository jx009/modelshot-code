// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/hooks/useAdminReason", () => ({ useAdminReason: () => ({ ask: async () => ({ key: "approval", reason: "Publish group QR code" }) }) }));
vi.mock("@/components/AnnouncementBanner", () => ({ AnnouncementContent: () => <div>Preview</div> }));
vi.mock("@/components/AnnouncementQr", () => ({ default: () => <div>QR preview</div>, announcementQrError: () => "上传失败" }));
import AnnouncementsPage from "../../src/app/[locale]/admin/announcements/page.js";
const item = { id: "notice_001", title: "社群公告", content: "欢迎加入", titleEn: "", contentEn: "", enabled: false, closable: true, style: "info", priority: 0, startAt: null, endAt: null, buttonText: "立即查看", buttonTextEn: "", buttonUrl: "" };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("uploads a QR to COS, previews it and persists the QR action with the announcement", async () => {
  const qrImage = { id: "c1c31ce9-6e12-4513-bf82-e583e13d7aa6", target: "a".repeat(32) };
  let items = [item];
  const fetch = vi.fn(async (url, init) => {
    if (url.endsWith("/qr")) return { ok: true, json: async () => ({ qrImage, region: "ap-guangzhou" }) };
    if (init?.method === "PATCH") items = JSON.parse(init.body).items;
    return { ok: true, json: async () => ({ items, version: "a".repeat(64) }) };
  });
  vi.stubGlobal("fetch", fetch);
  render(<AnnouncementsPage />);
  fireEvent.change(await screen.findByLabelText("按钮行为"), { target: { value: "qr" } });
  expect(screen.getByLabelText("按钮文案").value).toBe("点击加群");
  fireEvent.change(screen.getByLabelText("上传二维码"), { target: { files: [new File(["png"], "qr.png", { type: "image/png" })] } });
  await screen.findByText(/二维码已永久上传到腾讯 COS/);
  expect(fetch.mock.calls.find(([url]) => url.endsWith("/qr"))[1].body).toBeInstanceOf(FormData);
  fireEvent.click(screen.getByRole("button", { name: "保存所有公告" }));
  await waitFor(() => expect(items[0]).toMatchObject({ buttonAction: "qr", buttonText: "点击加群", qrImage }));
  await screen.findByText(/公告已保存/);
});
