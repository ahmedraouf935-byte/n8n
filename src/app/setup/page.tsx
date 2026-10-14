import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Button, Field, Input, Notice } from "@/components/ui";
import { getSql } from "@/lib/db/client";
import { login } from "@/lib/auth/session";
import { hitRateLimit } from "@/lib/auth/rateLimit";

export const dynamic = "force-dynamic";

/**
 * One-time owner bootstrap for hosted deployments (no terminal needed).
 * Works only while the users table is EMPTY and only with the SAFQA_SETUP_TOKEN secret.
 * After the first owner exists this page returns 404.
 */
async function hasUsers() {
  const [{ n }] = await getSql()<{ n: number }[]>`SELECT count(*)::int AS n FROM users`;
  return n > 0;
}

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await hasUsers()) notFound();
  const token = process.env.SAFQA_SETUP_TOKEN;
  const { error } = await searchParams;

  async function createOwner(fd: FormData) {
    "use server";
    const fail = (m: string) => redirect(`/setup?error=${encodeURIComponent(m)}`);
    const expected = process.env.SAFQA_SETUP_TOKEN ?? "";
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const sql = getSql();
    if (await hitRateLimit(sql, `setup:${ip}`, 5, 15 * 60)) fail("محاولات كثيرة، حاول لاحقًا");
    const given = String(fd.get("token") ?? "");
    if (expected.length < 16 || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) fail("رمز الإعداد غير صحيح");
    const email = String(fd.get("email") ?? "").trim();
    const name = String(fd.get("name") ?? "").trim() || "المالك";
    const password = String(fd.get("password") ?? "");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("بريد إلكتروني غير صالح");
    if (password.length < 12) fail("كلمة المرور 12 حرفًا على الأقل");
    if (password !== String(fd.get("confirm") ?? "")) fail("كلمتا المرور غير متطابقتين");
    const hash = await bcrypt.hash(password, 12);
    const created = await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(727002)`;
      const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM users`;
      if (n > 0) return false;
      const [u] = await tx<{ id: number }[]>`INSERT INTO users (email, name, password_hash, role) VALUES (${email}, ${name}, ${hash}, 'owner') RETURNING id`;
      await tx`INSERT INTO audit_logs (actor_id, actor_label, action, entity_type, entity_id) VALUES (${u.id}, 'setup', 'user.bootstrap_owner', 'users', ${u.id})`;
      return true;
    });
    if (!created) notFound();
    await login(email, password);
    redirect("/settings#capital");
  }

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-bold">إعداد صفقة لأول مرة</h1>
        <p className="mb-5 text-sm text-text-2">إنشاء حساب المالك. هذه الصفحة تعمل مرة واحدة فقط ثم تختفي.</p>
        {!token || token.length < 16 ? (
          <Notice tone="warn">لم يتم ضبط المتغير <code dir="ltr">SAFQA_SETUP_TOKEN</code> (16 حرفًا على الأقل) على الخادم. أضفه في إعدادات الاستضافة ثم أعد التحميل.</Notice>
        ) : (
          <>
            {error && <div className="mb-4"><Notice tone="bad">{error}</Notice></div>}
            <form action={createOwner} className="flex flex-col gap-3">
              <Field label="رمز الإعداد (SAFQA_SETUP_TOKEN)"><Input name="token" type="password" required dir="ltr" autoComplete="off" /></Field>
              <Field label="الاسم"><Input name="name" required /></Field>
              <Field label="البريد الإلكتروني"><Input name="email" type="email" required dir="ltr" autoComplete="username" /></Field>
              <Field label="كلمة المرور (12 حرفًا على الأقل)"><Input name="password" type="password" required minLength={12} dir="ltr" autoComplete="new-password" /></Field>
              <Field label="تأكيد كلمة المرور"><Input name="confirm" type="password" required minLength={12} dir="ltr" autoComplete="new-password" /></Field>
              <Button type="submit">إنشاء حساب المالك</Button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
