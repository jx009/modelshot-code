export function rechargeReturnPath(locale, values = {}) {
  const query = new URLSearchParams({ panel: "recharge" });
  if (typeof values.orderId === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(values.orderId)) query.set("orderId", values.orderId);
  if (["success", "cancelled"].includes(values.checkout)) query.set("checkout", values.checkout);
  return `/${locale === "en" ? "en" : "zh"}?${query}`;
}
