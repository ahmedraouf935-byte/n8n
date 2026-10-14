import "server-only";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireUser, type CurrentUser } from "../auth/session";
import { getSql, type Sql } from "../db/client";
import { DomainError } from "../services/errors";

async function flash(type: "ok" | "error", text: string) {
  (await cookies()).set("safqa_flash", encodeURIComponent(JSON.stringify({ type, text, id: Math.random().toString(36).slice(2) })), { path: "/", maxAge: 60, sameSite: "lax" });
}

export function errorMessage(e: unknown): string {
  if (e instanceof DomainError) {
    const failed = (e.details as { failed?: string[] } | undefined)?.failed;
    return failed?.length ? `${e.message}\n• ${failed.join("\n• ")}` : e.message;
  }
  if (e instanceof ZodError) return "بيانات غير صالحة: " + e.issues.map((i) => `${i.path.join(".")} — ${i.message}`).join("، ");
  console.error("[action]", e);
  return "حدث خطأ غير متوقع. تم تسجيله.";
}

/**
 * Runs a mutating server action for an authenticated user, flashes the result and redirects back.
 * Viewers can never mutate; `owner` actions are restricted further where passed.
 */
export async function act(
  back: string,
  fn: (ctx: { sql: Sql; user: CurrentUser }) => Promise<string | void | { redirect: string; message?: string }>,
  roles: CurrentUser["role"][] = ["owner", "operator"],
) {
  const user = await requireUser();
  let target = back;
  if (!roles.includes(user.role)) {
    await flash("error", "ليس لديك صلاحية لهذا الإجراء");
  } else {
    try {
      const r = await fn({ sql: getSql(), user });
      if (r && typeof r === "object") { target = r.redirect; await flash("ok", r.message ?? "تم بنجاح"); }
      else await flash("ok", r || "تم بنجاح");
    } catch (e) {
      await flash("error", errorMessage(e));
    }
  }
  revalidatePath("/", "layout");
  redirect(target);
}

// FormData readers
export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
export const num = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (v === null) return null;
  const n = Number(v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
export const int = (fd: FormData, k: string) => {
  const n = num(fd, k);
  return n === null ? null : Math.trunc(n);
};
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
