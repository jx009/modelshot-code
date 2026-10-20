import { expect, it } from "vitest";
import { announcementsSchema, selectAnnouncement, safeAnnouncementUrl, announcementLink } from "../../src/lib/announcements.js";

export const item = { id: "notice_001", title: "创作更新", content: "新模型上线", titleEn: "", contentEn: "", enabled: true, closable: true, style: "info", priority: 10, startAt: null, endAt: null, buttonText: "查看", buttonTextEn: "", buttonUrl: "/explore" };
it("selects only published announcements inside the half-open schedule window", () => {
  const now = Date.parse("2026-10-18T10:00:00Z");
  const rows = [item, { ...item, id: "notice_002", priority: 20, enabled: false }, { ...item, id: "notice_003", priority: 30, startAt: "2026-10-18T10:00:01Z" }, { ...item, id: "notice_004", priority: 40, endAt: "2026-10-18T10:00:00Z" }];
  expect(selectAnnouncement(rows, now).id).toBe(item.id);
  expect(selectAnnouncement([{ ...item, startAt: "2026-10-18T10:00:00Z" }], now)).toBeTruthy();
  expect(selectAnnouncement(rows.map(a => ({ ...a, enabled: false })), now)).toBeNull();
});
it.each(["javascript:alert(1)", "//evil.test", "/\\evil.test", "data:text/html,test", "https://good.test\n.evil.test", "ftp://example.test"])("rejects unsafe announcement link %s", value => {
  expect(safeAnnouncementUrl(value)).toBe(false);
  expect(announcementsSchema.safeParse([{ ...item, buttonUrl: value }]).success).toBe(false);
});
it("accepts and localizes internal links while preserving explicit locale and external links", () => {
  expect(announcementLink("/explore?q=art", "en")).toBe("/en/explore?q=art");
  expect(announcementLink("/zh/explore", "en")).toBe("/zh/explore");
  expect(announcementLink("https://example.test", "zh")).toBe("https://example.test");
  expect(safeAnnouncementUrl("https://example.test")).toBe(true);
});
it("rejects duplicate IDs, reverse schedule, missing button label and excessive announcements", () => {
  expect(announcementsSchema.safeParse([item, item]).success).toBe(false);
  expect(announcementsSchema.safeParse([{ ...item, startAt: "2026-10-19T00:00:00Z", endAt: "2026-10-18T00:00:00Z" }]).success).toBe(false);
  expect(announcementsSchema.safeParse([{ ...item, buttonText: "" }]).success).toBe(false);
  expect(announcementsSchema.safeParse(Array.from({ length: 21 }, (_, i) => ({ ...item, id: `notice_${i}` }))).success).toBe(false);
});
it("supports QR actions while requiring an uploaded image and preserving legacy links", () => {
  const qrImage = { id: "c1c31ce9-6e12-4513-bf82-e583e13d7aa6", target: "a".repeat(32) };
  expect(announcementsSchema.parse([item])).toEqual([item]);
  expect(announcementsSchema.safeParse([{ ...item, buttonAction: "qr", buttonUrl: "", qrImage }]).success).toBe(true);
  expect(announcementsSchema.safeParse([{ ...item, buttonAction: "qr" }]).success).toBe(false);
  expect(announcementsSchema.safeParse([{ ...item, buttonAction: "qr", qrImage, buttonText: "" }]).success).toBe(false);
  expect(announcementsSchema.safeParse([{ ...item, buttonAction: "qr", qrImage: { ...qrImage, id: "../../private" } }]).success).toBe(false);
});
