import { createHash } from "node:crypto";
import { announcementsSchema, selectAnnouncement } from "../announcements.js";
import { getSiteConfig, setSiteConfig } from "../site-config.js";
import { AppError } from "../http.js";

export function announcementVersion(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export async function getAnnouncements(db) {
  const raw = await getSiteConfig("announcements", db);
  const items = announcementsSchema.parse(raw ? JSON.parse(raw) : []);
  return { items, version: announcementVersion(items) };
}
export async function saveAnnouncements(tx, items, version) {
  // Serialize writes even when the config row does not exist yet.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(72619401)`;
  const before = await getAnnouncements(tx);
  if (before.version !== version) throw new AppError("ANNOUNCEMENTS_CHANGED", 409);
  await setSiteConfig("announcements", JSON.stringify(items), tx);
  return { audit: { before: before.items, after: items } };
}
export async function currentAnnouncement() {
  const { items } = await getAnnouncements();
  const item = selectAnnouncement(items);
  if (!item) return null;
  const { id, title, content, titleEn, contentEn, buttonText, buttonTextEn, buttonUrl, buttonAction, style, closable } = item;
  return { id, title, content, titleEn, contentEn, buttonText, buttonTextEn, buttonUrl, buttonAction, style, closable, revision: announcementVersion(item) };
}
