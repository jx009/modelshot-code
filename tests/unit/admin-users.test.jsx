// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminUsers from "../../src/app/[locale]/admin/users/page.js";
import { useRemoteResource } from "../../src/hooks/useRemoteResource.js";
import toast from "react-hot-toast";

vi.mock("../../src/hooks/useRemoteResource.js", () => ({ useRemoteResource: vi.fn() }));
vi.mock("../../src/lib/client-api.js", () => ({ requestKey: () => "admin-credit-test-key" }));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));

const user = {
  id: "user_1234567890123456",
  name: "测试用户",
  email: "user@example.com",
  image: null,
  role: "user",
  status: "active",
  plan: "free",
  credits: 20,
  monthUsage: 0,
  tryonCount: 0,
};

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal() { this.open = true; });
  HTMLDialogElement.prototype.close = vi.fn(function close() { this.open = false; });
  useRemoteResource.mockReturnValue({
    data: { users: [user], total: 1, page: 1, limit: 20 },
    loading: false,
    error: null,
    reload: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("admin user credit adjustment", () => {
  it("opens confirmation, submits the adjustment, and clears the row after success", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetch);
    render(<AdminUsers />);

    const amount = screen.getByLabelText("调整 测试用户 的积分");
    fireEvent.change(amount, { target: { value: "75" } });
    fireEvent.click(screen.getByRole("button", { name: "提交 测试用户 的积分调整" }));

    expect(screen.getByRole("dialog", { name: "确认用户变更" })).toBeTruthy();
    expect(screen.getByText("积分 +75")).toBeTruthy();
    expect(amount.value).toBe("75");

    fireEvent.change(screen.getByLabelText("操作原因"), { target: { value: "新用户补偿积分" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/admin/users", expect.objectContaining({
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "admin-credit-test-key" },
      body: JSON.stringify({ id: user.id, creditsDelta: 75, reason: "新用户补偿积分" }),
    })));
    await waitFor(() => expect(amount.value).toBe(""));
    expect(toast.success).toHaveBeenCalledWith("积分 +75");
  });

  it("keeps the amount and shows the server error when a debit is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ code: "INSUFFICIENT_CREDITS", traceId: "trace-123" }),
    }));
    render(<AdminUsers />);

    const amount = screen.getByLabelText("调整 测试用户 的积分");
    fireEvent.change(amount, { target: { value: "-50" } });
    fireEvent.click(screen.getByRole("button", { name: "提交 测试用户 的积分调整" }));
    fireEvent.change(screen.getByLabelText("操作原因"), { target: { value: "修正错误积分" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("用户可用积分不足，无法完成扣减（追踪号 trace-123）"));
    expect(amount.value).toBe("-50");
    expect(screen.getByRole("dialog", { name: "确认用户变更" })).toBeTruthy();
  });
});
