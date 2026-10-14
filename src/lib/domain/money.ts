/** Round to 2 decimals (piastres), avoiding binary float drift such as 1.005 -> 1.00. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function sum(values: number[]): number {
  return round2(values.reduce((a, b) => a + b, 0));
}

const egp = new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 1 });

export function formatEGP(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return egp.format(n);
}
export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return num.format(n);
}
export function formatPct(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${pct.format(n)}٪`;
}
