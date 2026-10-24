import { expect, it } from "vitest";
import { CREATION_MESSAGE_WINDOW, mergeConversationWindow } from "../../src/lib/creation/conversation-window.js";

const page = (first, last) => ({ items: Array.from({ length: last - first + 1 }, (_, index) => ({ id: `m${first + index}`, sequence: first + index, text: `message ${first + index}` })), nextCursor: first > 1 ? first : null });
it("preserves loaded history when refreshed with an overlapping latest page", () => {
  const original = page(51, 150), result = mergeConversationWindow(original, page(102, 151));
  expect(result.items).toHaveLength(101);
  expect(result.items[0].id).toBe("m51"); expect(result.items.at(-1).id).toBe("m151");
  expect(result.nextCursor).toBe(51); expect(result.hasNewer).toBe(false);
  expect(original.items).toHaveLength(100);
});
it("prepends deduplicated older pages with their cursor", () => {
  const result = mergeConversationWindow(page(51, 100), page(1, 55), "older");
  expect(result.items.map(item => item.sequence)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  expect(result.nextCursor).toBeNull(); expect(result.hasNewer).toBe(false);
});
it("bounds history at 200 messages and records when newer content was dropped", () => {
  const result = mergeConversationWindow(page(101, 300), page(51, 100), "older");
  expect(result.items).toHaveLength(CREATION_MESSAGE_WINDOW);
  expect(result.items[0].sequence).toBe(51); expect(result.items.at(-1).sequence).toBe(250);
  expect(result.hasNewer).toBe(true); expect(result.nextCursor).toBe(51);
  const refresh = mergeConversationWindow(result, page(251, 300));
  expect(refresh.items).toBe(result.items);
});
it("signals newer messages instead of silently joining distant pages across a gap", () => {
  const original = page(1, 50), result = mergeConversationWindow(original, page(101, 150));
  expect(result.items).toBe(original.items); expect(result.hasNewer).toBe(true);
});
it("returns to a fresh latest window only when requested", () => {
  const result = mergeConversationWindow({ ...page(1, 200), hasNewer: true }, page(301, 350), "latest");
  expect(result.items).toHaveLength(50); expect(result.items[0].id).toBe("m301");
  expect(result.nextCursor).toBe(301); expect(result.hasNewer).toBe(false);
});
it("keeps the current window when a refresh returns no messages", () => {
  const original = page(1, 50);
  expect(mergeConversationWindow(original, { items: [], nextCursor: null })).toBe(original);
});
