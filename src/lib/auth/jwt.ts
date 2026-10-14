// Edge-safe session token helpers (used by middleware and server code).
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "safqa_session";
export const SESSION_HOURS = 12;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (at least 32 characters)");
  return new TextEncoder().encode(s);
}

export interface SessionClaims {
  uid: number;
  role: "owner" | "operator" | "viewer";
  name: string;
}

export async function signSession(c: SessionClaims) {
  return new SignJWT({ ...c })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .setIssuer("safqa")
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: "safqa", algorithms: ["HS256"] });
    return { uid: Number(payload.uid), role: payload.role as SessionClaims["role"], name: String(payload.name) };
  } catch {
    return null;
  }
}
