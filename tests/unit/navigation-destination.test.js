import { expect, test } from "vitest";
import { contentTransition, destinationPath, destinationSection } from "../../src/lib/navigation-destination.js";

test("normalizes locale prefixes without treating the canvas as a creative layout", () => {
  expect(destinationPath("https://example.com/zh/admin/users?page=2")).toBe("/admin/users");
  expect(destinationPath("/en/")).toBe("/");
  expect(destinationSection("/zh/explore/example")).toBe("creative");
  expect(destinationSection("/zh/studio-v2")).toBe("root");
  expect(destinationSection("/zh/admin/users")).toBe("admin");
});

test("keeps the shared shell for navigation within a section", () => {
  const navigation = { from: "/zh/admin", href: "/zh/admin/users" };
  expect(contentTransition(navigation, "admin")).toBe(true);
  expect(contentTransition(navigation, "root")).toBe(false);
  expect(contentTransition(navigation, "creative")).toBe(false);
});

test("replaces the root content when the destination uses another layout", () => {
  const navigation = { from: "/zh/explore", href: "/zh/studio-v2" };
  expect(contentTransition(navigation, "root")).toBe(true);
  expect(contentTransition(navigation, "creative")).toBe(false);
});

test("does not replace the whole page for filters, hashes or locale-only changes", () => {
  for (const href of ["/zh/admin/users?page=2", "/zh/admin/users#row", "/en/admin/users"]) {
    expect(contentTransition({ from: "/zh/admin/users", href }, "admin")).toBe(false);
    expect(contentTransition({ from: "/zh/admin/users", href }, "root")).toBe(false);
  }
  expect(contentTransition(null, "root")).toBe(false);
});
