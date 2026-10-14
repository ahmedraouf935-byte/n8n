import { cookies } from "next/headers";
import { Flash, type FlashMsg } from "@/components/Flash";
import { Nav } from "@/components/Nav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { requireUser } from "@/lib/auth/session";
import { getSql } from "@/lib/db/client";
import { getDatabaseEnvironment } from "@/lib/db/migrate";
import { logoutAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  let flash: FlashMsg | null = null;
  try {
    const raw = (await cookies()).get("safqa_flash")?.value;
    if (raw) flash = JSON.parse(decodeURIComponent(raw));
  } catch {}
  const sql = getSql();
  const env = await getDatabaseEnvironment(sql);
  const [b] = await sql<{ decisions: number; orders: number; verifications: number }[]>`
    SELECT (SELECT count(*)::int FROM purchase_decisions WHERE status = 'pending') AS decisions,
           (SELECT count(*)::int FROM sales_orders WHERE status IN ('new','confirmed','packed')) AS orders,
           (SELECT count(*)::int FROM supplier_offers WHERE status = 'unverified' AND variant_id IS NOT NULL) AS verifications`;
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="border-border bg-surface lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-l">
        <div className="hidden items-center gap-2 px-6 pt-6 pb-3 lg:flex">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-lg font-bold text-accent-ink">ص</div>
          <div>
            <div className="text-base font-bold leading-tight">صفقة</div>
            <div className="text-[11px] tracking-widest text-muted" dir="ltr">SAFQA</div>
          </div>
        </div>
        <Nav badges={{ "/purchases": b.decisions, "/orders": b.orders, "/suppliers": b.verifications }} />
      </aside>
      <div className="min-w-0">
        {env !== "production" && (
          <div className="bg-info-soft py-2 pr-14 pl-4 text-center text-sm font-medium text-info lg:px-4">
            ◇ بيئة {env === "demo" ? "تجريبية — كل البيانات هنا وهمية للعرض فقط ولا تمثل سوقًا حقيقيًا" : `اختبار (${env})`}
          </div>
        )}
        <header className="flex items-center justify-end gap-3 border-b border-border bg-surface py-2.5 pr-14 pl-4 sm:pl-8 lg:px-8">
          <span className="text-xs text-muted">توقيت القاهرة</span>
          <ThemeToggle />
          <span className="text-sm text-text-2">{user.name}</span>
          <form action={logoutAction}><button className="rounded-lg px-2 py-1 text-xs text-text-2 hover:bg-surface-2">خروج</button></form>
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-8">{children}</main>
      </div>
      <Flash key={flash?.id ?? "none"} initial={flash} />
    </div>
  );
}
