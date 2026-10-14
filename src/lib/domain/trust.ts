/** Trust labels shown next to every critical figure in the dashboard. */
export type TrustLabel = "verified" | "unverified" | "estimated" | "stale" | "unavailable" | "demo";

export const TRUST_LABEL_AR: Record<TrustLabel, string> = {
  verified: "مؤكد",
  unverified: "غير مؤكد",
  estimated: "تقديري",
  stale: "قديم",
  unavailable: "غير متوفر",
  demo: "تجريبي",
};

export interface OfferForStatus {
  quotedAt: Date | string;
  staleAfterDays: number;
  status?: string;
}
export interface VerificationForStatus {
  result: "available" | "unavailable" | "partial" | "price_changed";
  validUntil: Date | string;
  verifiedAt: Date | string;
}

/**
 * Effective status of a supplier offer.
 *  - latest verification says unavailable -> unavailable
 *  - a still-valid human verification     -> verified
 *  - quote older than staleAfterDays       -> stale
 *  - otherwise                             -> unverified
 */
export function supplierOfferStatus(
  offer: OfferForStatus,
  latest: VerificationForStatus | null,
  now: Date = new Date(),
): "verified" | "unverified" | "stale" | "unavailable" {
  if (offer.status === "rejected") return "unavailable";
  if (latest) {
    if (latest.result === "unavailable") return "unavailable";
    if (new Date(latest.validUntil) > now) return "verified";
    return "stale";
  }
  const ageDays = (now.getTime() - new Date(offer.quotedAt).getTime()) / 86_400_000;
  return ageDays > offer.staleAfterDays ? "stale" : "unverified";
}

export function isFresh(observedAt: Date | string, freshDays: number, now: Date = new Date()): boolean {
  return (now.getTime() - new Date(observedAt).getTime()) / 86_400_000 <= freshDays;
}
