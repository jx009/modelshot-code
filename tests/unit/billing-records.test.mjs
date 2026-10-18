import { expect, it } from "vitest";
import { recordType, recordDetail, orderStatus } from "../../src/lib/billing-records.js";

it("uses specific operations, meaningful refunds and no raw internal reason", () => {
  expect(recordType({ type: "consume", operation: "generate" }, "zh")).toBe("生图");
  expect(recordType({ type: "refund", operation: "inpaint" }, "zh")).toBe("局部修改 · 退款");
  expect(recordType({ type: "consume", operation: "ocr" }, "en")).toBe("Recognize text");
  expect(recordType({ type: "consume", operation: null }, "zh")).toBe("历史任务");
  expect(recordDetail({ type: "purchase", reason: "private-order-id" }, "zh")).toBe("支付成功，积分到账");
  expect(recordDetail({ type: "consume", reason: "capture", resolution: "2K" }, "zh")).toBe("已完成扣费 · 2K");
  expect(orderStatus({ status: "paid", refundedMinor: 100 }, "zh")).toBe("部分退款");
  expect(orderStatus({ status: "pending" }, "zh")).toBe("待支付");
});
