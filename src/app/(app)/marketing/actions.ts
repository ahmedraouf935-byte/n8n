"use server";
import { act, int, num, str } from "@/lib/ui/action";
import { addImageAsset, approvePost, generateDrafts, schedulePost, setAssetStatus } from "@/lib/services/marketing";
import { addExpense } from "@/lib/services/expenses";
import { audit } from "@/lib/services/audit";
import { DomainError } from "@/lib/services/errors";

const back = (fd: FormData) => `/marketing${fd.get("variantId") ? `?variant=${fd.get("variantId")}` : ""}`;

export async function generateAction(fd: FormData) {
  await act(back(fd), async ({ sql, user }) => {
    const price = num(fd, "price");
    if (!price) throw new DomainError("حدد سعر البيع");
    const r = await generateDrafts(sql, user, Number(fd.get("variantId")), price);
    return r.generatedBy === "ai" ? "تم توليد مسودات بالذكاء الاصطناعي — راجعها قبل الاعتماد" : "Claude غير مُعد — تم إنشاء مسودات من قالب ثابت";
  });
}
export async function assetStatusAction(fd: FormData) {
  await act(back(fd), async ({ sql, user }) => { await setAssetStatus(sql, user, Number(fd.get("assetId")), String(fd.get("status")) as "approved", str(fd, "content") ?? undefined); });
}
export async function imageAction(fd: FormData) {
  await act(back(fd), async ({ sql, user }) => {
    const url = str(fd, "imageUrl");
    if (!url) throw new DomainError("أدخل رابط الصورة");
    await addImageAsset(sql, user, Number(fd.get("variantId")), url, (str(fd, "rights") as "owned") ?? "owned");
  });
}
export async function scheduleAction(fd: FormData) {
  await act(back(fd), async ({ sql, user }) => {
    await schedulePost(sql, user, { captionAssetId: int(fd, "assetId"), platform: str(fd, "platform"), scheduledFor: str(fd, "scheduledFor"), imageUrl: str(fd, "imageUrl") });
    return "تمت الجدولة";
  });
}
export async function approvePostAction(fd: FormData) {
  await act("/marketing", async ({ sql, user }) => { await approvePost(sql, user, Number(fd.get("postId"))); return "تم اعتماد المنشور للنشر في موعده"; }, ["owner"]);
}
export async function cancelPostAction(fd: FormData) {
  await act("/marketing", async ({ sql, user }) => {
    await sql`UPDATE scheduled_posts SET status = 'cancelled' WHERE id = ${Number(fd.get("postId"))} AND status <> 'published'`;
    await audit(sql, user, "post.cancel", "scheduled_posts", Number(fd.get("postId")), null, {});
  });
}
export async function campaignAction(fd: FormData) {
  await act("/marketing", async ({ sql, user }) => {
    const spend = num(fd, "spend") ?? 0;
    return sql.begin(async (tx) => {
      const [c] = await tx<{ id: number }[]>`INSERT INTO campaign_results (variant_id, name, platform, campaign_type, start_date, end_date, spend, impressions, clicks, messages, notes)
        VALUES (${int(fd, "variantId")}, ${str(fd, "name") ?? "حملة"}, ${str(fd, "platform") ?? "facebook"}, ${str(fd, "type") ?? "paid"}, ${str(fd, "startDate") ?? new Date().toISOString().slice(0, 10)},
          ${str(fd, "endDate")}, ${spend}, ${int(fd, "impressions")}, ${int(fd, "clicks")}, ${int(fd, "messages")}, ${str(fd, "notes")}) RETURNING id`;
      if (spend > 0) await addExpense(tx, user, { category: "advertising", amount: spend, description: `إعلان: ${str(fd, "name")}`, variantId: int(fd, "variantId"), campaignId: c.id });
      await audit(tx, user, "campaign.create", "campaign_results", c.id, null, { spend });
      return "تم تسجيل الحملة" + (spend > 0 ? " وخصم الإنفاق من النقدية" : "");
    });
  });
}
