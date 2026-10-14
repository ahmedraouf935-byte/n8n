import { redirect } from "next/navigation";
import { login, getCurrentUser } from "@/lib/auth/session";
import { getSql } from "@/lib/db/client";
import { Button, Field, Input, Notice } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCurrentUser().catch(() => null)) redirect("/");
  const [{ n }] = await getSql()<{ n: number }[]>`SELECT count(*)::int AS n FROM users`;
  if (n === 0) redirect("/setup");
  const { error } = await searchParams;
  async function doLogin(fd: FormData) {
    "use server";
    const r = await login(String(fd.get("email") ?? ""), String(fd.get("password") ?? ""));
    if (!r.ok) redirect(`/login?error=${encodeURIComponent(r.error)}`);
    redirect("/");
  }
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-xl font-bold text-accent-ink">ص</div>
          <div>
            <h1 className="text-xl font-bold">صفقة</h1>
            <p className="text-xs text-muted">منصة ذكاء تجاري — دخول المالك</p>
          </div>
        </div>
        {error && <div className="mb-4"><Notice tone="bad">{error}</Notice></div>}
        <form action={doLogin} className="flex flex-col gap-4">
          <Field label="البريد الإلكتروني"><Input name="email" type="email" required autoComplete="username" dir="ltr" /></Field>
          <Field label="كلمة المرور"><Input name="password" type="password" required autoComplete="current-password" dir="ltr" /></Field>
          <Button type="submit">دخول</Button>
        </form>
      </div>
    </main>
  );
}
