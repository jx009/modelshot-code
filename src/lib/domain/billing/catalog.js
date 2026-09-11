export const CATALOG_VERSION = "2026-09-v1";
export const CATALOG = Object.freeze({
  basic: { id: "basic", name: "Basic Pack", type: "credits", currency: "usd", amountMinor: 500, credits: 1000 },
  standard: { id: "standard", name: "Standard Pack", type: "credits", currency: "usd", amountMinor: 1000, credits: 2000 },
  pro: { id: "pro", name: "Professional Pack", type: "credits", currency: "usd", amountMinor: 2000, credits: 4000 },
  business: { id: "business", name: "Business Pack", type: "credits", currency: "usd", amountMinor: 5000, credits: 10000 },
  sub_standard: { id: "sub_standard", name: "Standard", type: "subscription", plan: "standard", currency: "usd", amountMinor: 2900, quota: 300 },
  sub_pro: { id: "sub_pro", name: "Pro", type: "subscription", plan: "pro", currency: "usd", amountMinor: 9900, quota: 1500 },
});

export function formatMoney(amountMinor, currency = "usd", locale = "en") {
  const formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits;
  return formatter.format(amountMinor / (10 ** digits));
}

export function proportionalMinor(amount, numerator, denominator) {
  if (![amount, numerator, denominator].every(Number.isSafeInteger) || amount < 0 || numerator < 0 || denominator <= 0) throw new Error("Invalid monetary operands");
  return Number((BigInt(amount) * BigInt(numerator) + BigInt(Math.floor(denominator / 2))) / BigInt(denominator));
}
