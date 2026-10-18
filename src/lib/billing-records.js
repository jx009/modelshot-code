import { getTool } from "./studio/tool-catalog.js";

const ACTIVITIES = {
  generate: ["生图", "Image generation"],
  "studio-optimize": ["提示词优化", "Prompt optimization"],
  "studio-plan": ["创作规划", "Creative planning"],
  "commerce-agent": ["电商套图规划", "Commerce planning"],
  "focus-identify": ["焦点识别", "Focus identification"],
};
const TYPES = {
  purchase: ["积分充值", "Credit purchase"],
  registration_bonus: ["注册赠送", "Welcome credits"],
  grant: ["积分赠送", "Credit grant"],
  adjustment: ["积分调整", "Credit adjustment"],
  payment_refund: ["充值退款", "Payment refund"],
  refund: ["任务退款", "Task refund"],
  consume: ["历史任务", "Past task"],
};
const STATUSES = {
  paid: ["已到账", "Paid"], pending: ["待支付", "Pending"],
  refunded: ["已退款", "Refunded"], partially_refunded: ["部分退款", "Partially refunded"],
  failed: ["支付失败", "Failed"], cancelled: ["已关闭", "Cancelled"], expired: ["已过期", "Expired"],
};

export function activityName(operation, locale) {
  const index = locale === "zh" ? 0 : 1;
  if (ACTIVITIES[operation]) return ACTIVITIES[operation][index];
  const tool = getTool(operation);
  return tool ? tool[locale === "zh" ? "zh" : "en"] : null;
}

export function recordType(row, locale) {
  const zh = locale === "zh", activity = activityName(row.operation, locale);
  if (activity) return row.type === "refund" ? `${activity} · ${zh ? "退款" : "Refund"}` : activity;
  return TYPES[row.type]?.[zh ? 0 : 1] || (zh ? "积分变动" : "Credit change");
}

export function recordDetail(row, locale) {
  const zh = locale === "zh";
  const details = {
    consume: zh ? "已完成扣费" : "Charge completed",
    refund: zh ? "积分已退回" : "Credits returned",
    purchase: zh ? "支付成功，积分到账" : "Payment confirmed, credits added",
    registration_bonus: zh ? "新用户注册奖励" : "Welcome bonus",
    grant: zh ? "奖励积分到账" : "Bonus credits added",
    adjustment: zh ? "管理员调整" : "Administrator adjustment",
    payment_refund: zh ? "退款对应积分已扣回" : "Refunded credits reclaimed",
  };
  return [details[row.type] || (zh ? "余额已更新" : "Balance updated"), row.resolution].filter(Boolean).join(" · ");
}

export function orderStatus(row, locale) {
  const status = row.status === "paid" && row.refundedMinor > 0 ? "partially_refunded" : row.status;
  return STATUSES[status]?.[locale === "zh" ? 0 : 1] || (locale === "zh" ? "处理中" : "Processing");
}
