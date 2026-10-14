"use server";
import { act, num, str } from "@/lib/ui/action";
import { ingestTrendSignals, linkSignalToProduct, parseTrendCsv, setSignalStatus } from "@/lib/services/trends";
import { DomainError } from "@/lib/services/errors";

export async function addSignalAction(fd: FormData) {
  await act("/trends", async ({ sql, user }) => {
    const method = str(fd, "method") === "owner_screenshot" ? "owner_screenshot" : "manual_entry";
    const r = await ingestTrendSignals(sql, user, {
      sourceCode: method === "owner_screenshot" ? "owner_screenshot" : "manual_entry",
      method,
      items: [{
        title: str(fd, "title"), titleEn: str(fd, "titleEn"), platform: str(fd, "platform"), sourceUrl: str(fd, "sourceUrl"),
        imageUrl: str(fd, "imageUrl"), region: str(fd, "region") ?? "EG", metricType: str(fd, "metricType"),
        metricValue: num(fd, "metricValue"), previousValue: num(fd, "previousValue"), evidenceType: str(fd, "evidenceType"),
        discoveredAt: str(fd, "discoveredAt") ?? undefined, notes: str(fd, "notes"),
      }],
    });
    if (r.failed) throw new DomainError(r.errors.map((e) => e.error).join("\n"));
    return r.duplicate ? "هذه الإشارة مسجلة من قبل (تم تجاهل التكرار)" : "تم تسجيل إشارة الترند مع المصدر والتوقيت";
  });
}

export async function importCsvAction(fd: FormData) {
  await act("/trends", async ({ sql, user }) => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new DomainError("اختر ملف CSV");
    if (file.size > 2_000_000) throw new DomainError("الملف أكبر من 2 ميجابايت");
    const { items, errors } = parseTrendCsv(await file.text());
    if (errors.length) throw new DomainError(errors.join("\n"));
    const r = await ingestTrendSignals(sql, user, { sourceCode: "csv_import", method: "csv_import", items });
    return `تم الاستيراد: ${r.created} جديد، ${r.duplicate} مكرر، ${r.failed} مرفوض${r.errors.length ? `\n${r.errors.slice(0, 5).map((e) => `سطر ${e.index + 2}: ${e.error}`).join("\n")}` : ""}`;
  });
}

export async function signalStatusAction(fd: FormData) {
  await act("/trends", async ({ sql, user }) => {
    await setSignalStatus(sql, user, Number(fd.get("id")), String(fd.get("status")) as "saved");
  });
}

export async function linkSignalAction(fd: FormData) {
  await act("/trends", async ({ sql, user }) => {
    await linkSignalToProduct(sql, user, Number(fd.get("id")), Number(fd.get("productId")));
    return "تم ربط الإشارة بالمنتج";
  });
}
