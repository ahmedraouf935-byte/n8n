import "server-only";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSql } from "../db/client";
import type { Actor } from "../services/audit";
import { SESSION_COOKIE, SESSION_HOURS, signSession, verifySession } from "./jwt";
import { hitRateLimit } from "./rateLimit";

export interface CurrentUser extends Actor {
  id: number;
  name: string;
  email: string;
  role: "owner" | "operator" | "viewer";
}

/** Loads the signed-in user (re-checking the DB so deactivated users lose access immediately). */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const claims = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  const [u] = await getSql()<{ id: number; name: string; email: string; role: CurrentUser["role"] }[]>`
    SELECT id, name, email, role FROM users WHERE id = ${claims.uid} AND is_active`;
  return u ? { ...u, label: `${u.role}:${u.email}` } : null;
}

export async function requireUser(roles?: CurrentUser["role"][]): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  if (roles && !roles.includes(u.role)) throw new Error("ليس لديك صلاحية لهذا الإجراء");
  return u;
}

let dummyHash: string | undefined;

export async function login(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const sql = getSql();
  if (await hitRateLimit(sql, `login:${ip}:${email.toLowerCase()}`, 5, 15 * 60))
    return { ok: false, error: "محاولات كثيرة. حاول بعد 15 دقيقة." };
  const [u] = await sql<{ id: number; name: string; role: CurrentUser["role"]; password_hash: string }[]>`
    SELECT id, name, role, password_hash FROM users WHERE lower(email) = lower(${email}) AND is_active`;
  // compare against a dummy hash when the user doesn't exist to keep timing similar
  dummyHash ??= bcrypt.hashSync("safqa-timing-dummy", 12);
  const ok = await bcrypt.compare(password, u?.password_hash ?? dummyHash);
  if (!u || !ok) return { ok: false, error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" };
  await sql`UPDATE users SET last_login_at = now() WHERE id = ${u.id}`;
  await sql`INSERT INTO audit_logs (actor_id, actor_label, action, entity_type, entity_id) VALUES (${u.id}, ${`${u.role}:${email}`}, 'auth.login', 'users', ${u.id})`;
  const token = await signSession({ uid: u.id, role: u.role, name: u.name });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_HOURS * 3600,
  });
  return { ok: true };
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
}
