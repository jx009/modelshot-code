import { z } from "zod";

export function safeAnnouncementUrl(value) {
  if (!value) return true;
  if (/[\\\x00-\x20]/.test(value) || value.startsWith("//")) return false;
  if (value.startsWith("/")) return true;
  try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; }
}

export const announcementQrSchema = z.object({ id: z.uuid(), target: z.string().regex(/^[a-f0-9]{32}$/) }).strict();

export const announcementSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{8,64}$/),
  title: z.string().trim().min(1).max(80), content: z.string().trim().max(300),
  titleEn: z.string().trim().max(120), contentEn: z.string().trim().max(400),
  enabled: z.boolean(), closable: z.boolean(),
  style: z.enum(["info", "success", "warning", "error"]),
  priority: z.number().int().min(0).max(9999),
  startAt: z.iso.datetime().nullable(), endAt: z.iso.datetime().nullable(),
  buttonText: z.string().trim().max(24), buttonTextEn: z.string().trim().max(40),
  buttonUrl: z.string().trim().max(500).refine(safeAnnouncementUrl),
  buttonAction: z.enum(["link", "qr"]).optional(),
  qrImage: announcementQrSchema.nullable().optional(),
}).strict().refine(a => !a.startAt || !a.endAt || a.startAt < a.endAt, { message: "结束时间必须晚于开始时间" })
  .refine(a => !(a.buttonAction === "qr" || a.buttonUrl) || Boolean(a.buttonText), { message: "请填写按钮文案" })
  .refine(a => a.buttonAction !== "qr" || Boolean(a.qrImage), { message: "请先上传二维码" });
export const announcementsSchema = z.array(announcementSchema).max(20)
  .refine(items => new Set(items.map(a => a.id)).size === items.length, { message: "公告 ID 重复" });
export function selectAnnouncement(items, now = Date.now()) {
  return items.filter(a => a.enabled && (!a.startAt || Date.parse(a.startAt) <= now) && (!a.endAt || Date.parse(a.endAt) > now))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0] || null;
}
export function announcementLink(url, locale) {
  if (!url?.startsWith("/") || /^\/(zh|en)(\/|\?|#|$)/.test(url)) return url;
  return `/${locale}${url === "/" ? "" : url}`;
}
