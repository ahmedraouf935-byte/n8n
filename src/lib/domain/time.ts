export const CAIRO_TZ = "Africa/Cairo";

const dt = new Intl.DateTimeFormat("ar-EG", { timeZone: CAIRO_TZ, dateStyle: "medium", timeStyle: "short" });
const d = new Intl.DateTimeFormat("ar-EG", { timeZone: CAIRO_TZ, dateStyle: "medium" });
const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: CAIRO_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export function formatDateTime(v: Date | string | null | undefined): string {
  if (!v) return "—";
  return dt.format(new Date(v));
}
export function formatDate(v: Date | string | null | undefined): string {
  if (!v) return "—";
  return d.format(new Date(v));
}
/** YYYY-MM-DD for the given instant in Cairo. */
export function cairoDateKey(v: Date = new Date()): string {
  return ymd.format(v);
}
export function daysBetween(a: Date | string, b: Date | string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
}
export function addDays(v: Date, days: number): Date {
  return new Date(v.getTime() + days * 86_400_000);
}
