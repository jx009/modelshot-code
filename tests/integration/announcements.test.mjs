import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";
import { domainFixture } from "../support/domain-fixture.mjs";
import { getAnnouncements, saveAnnouncements } from "../../src/lib/server/announcements.js";
import { auditedOperation } from "../../src/lib/domain/identity/admin-operation.js";

let f, original, admin;
const item = { id: "notice_001", title: "创作更新", content: "新的生图模型上线", titleEn: "", contentEn: "", enabled: true, closable: true, style: "info", priority: 10, startAt: null, endAt: null, buttonText: "查看", buttonTextEn: "", buttonUrl: "/explore" };
beforeAll(async () => {
  f = await domainFixture();
  original = await f.db.systemConfig.findUnique({ where: { key: "announcements" } });
  await f.db.systemConfig.upsert({ where: { key: "announcements" }, create: { key: "announcements", value: "[]" }, update: { value: "[]" } });
  admin = await f.user();
  await f.db.user.update({ where: { id: admin.id }, data: { role: "admin" } });
});
afterAll(async () => {
  if (!f) return;
  if (original) await f.db.systemConfig.update({ where: { key: "announcements" }, data: { value: original.value } });
  else await f.db.systemConfig.deleteMany({ where: { key: "announcements" } });
  await f.cleanup();
});
it("persists, audits, replays safely, and refuses a stale administrator overwrite", async () => {
  const before = await getAnnouncements(f.db), key = randomUUID();
  const input = { items: [item], version: before.version, reason: "Publish new model notice" };
  const save = () => auditedOperation(admin.id, key, "UPDATE_ANNOUNCEMENTS", input, tx => saveAnnouncements(tx, input.items, input.version), f.db);
  await save();
  const stored = await getAnnouncements(f.db);
  expect(stored.items).toEqual([item]); expect(stored.version).not.toBe(before.version);
  expect((await save()).replayed).toBe(true);
  const audit = await f.db.adminAuditLog.findUnique({ where: { businessKey: `operation:${admin.id}:${key}` } });
  expect(JSON.parse(audit.detail)).toMatchObject({ before: [], after: [item] });
  await expect(auditedOperation(admin.id, randomUUID(), "UPDATE_ANNOUNCEMENTS", { ...input, items: [] }, tx => saveAnnouncements(tx, [], before.version), f.db)).rejects.toMatchObject({ code: "ANNOUNCEMENTS_CHANGED" });
  expect((await getAnnouncements(f.db)).items).toEqual([item]);
});
it("allows just one concurrent edit from the same base version", async () => {
  const before = await getAnnouncements(f.db);
  const other = await f.user();
  await f.db.user.update({ where: { id: other.id }, data: { role: "admin" } });
  const results = await Promise.allSettled([admin, other].map((actor, i) => {
    const input = { items: [{ ...item, title: `Concurrent ${i}` }], version: before.version, reason: "Concurrent notice update" };
    return auditedOperation(actor.id, randomUUID(), "UPDATE_ANNOUNCEMENTS", input, tx => saveAnnouncements(tx, input.items, input.version), f.db);
  }));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find(r => r.status === "rejected").reason.code).toBe("ANNOUNCEMENTS_CHANGED");
});
