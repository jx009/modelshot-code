import { expect, it, vi } from "vitest";
import { dispatchOutbox } from "../../src/lib/infra/queue/index.js";

it("isolates creation scheduling and notifications from payments and model slots", async () => {
  const events = ["payment", "generate", "creation-advance", "creation-notify", "creation-language", "creation-export", "creation-import"].map((kind, index) => ({ kind, id: `event-${index}`, entityId: "entity" }));
  const db = { outboxEvent: { findMany: vi.fn(async () => events), update: vi.fn(), updateMany: vi.fn() } };
  const main = { add: vi.fn() }, image = { add: vi.fn() }, creation = { add: vi.fn() }, language = { add: vi.fn() }, exports = { add: vi.fn() };
  await dispatchOutbox(db, main, 100, null, image, creation, language, exports);
  expect(main.add.mock.calls.map(call => call[0])).toEqual(["payment"]);
  expect(image.add.mock.calls.map(call => call[0])).toEqual(["generate"]);
  expect(creation.add.mock.calls.map(call => call[0])).toEqual(["creation-advance", "creation-notify"]);
  expect(language.add.mock.calls.map(call => call[0])).toEqual(["creation-language"]);
  expect(exports.add.mock.calls.map(call => call[0])).toEqual(["creation-export", "creation-import"]);
});
it("leaves creation outbox entries pending when an older dispatcher has no creation queue", async () => {
  const db = { outboxEvent: { findMany: vi.fn(async () => []), update: vi.fn(), updateMany: vi.fn() } };
  await dispatchOutbox(db, { add: vi.fn() });
  expect(db.outboxEvent.findMany.mock.calls[0][0].where.kind.notIn).toEqual(["creation-advance", "creation-notify", "creation-language", "creation-export", "creation-import"]);
});
