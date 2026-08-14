import { createHmac, timingSafeEqual, scryptSync, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users, usersBusinesses, businesses } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/* ------------------------------ الجلسة ------------------------------ */
const COOKIE = "merchant_session";
const SECRET = process.env.AUTH_SECRET || "mos-dev-secret-2025";

const sign = (payload: Record<string, unknown>): string => {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const h = createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${h}`;
};

const verify = (token: string): Record<string, unknown> | null => {
  const [body, h] = token.split(".");
  if (!body || !h) return null;
  const expect = createHmac("sha256", SECRET).update(body).digest("base64url");
  const a = Buffer.from(h);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (typeof p.exp === "number" && p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
};

export async function setSession(userId: number, businessId: number) {
  const jar = await cookies();
  jar.set(
    COOKIE,
    sign({ userId, businessId, exp: Date.now() + 7 * 86400_000 }),
    { httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 86400 },
  );
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/* ---------------------------- كلمة المرور ---------------------------- */
export const hashPassword = (password: string): string => {
  const salt = randomBytes(8).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
};

export const verifyPassword = (password: string, stored: string): boolean => {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(password, salt, 32).toString("hex");
  const a = Buffer.from(test);
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
};

/* ----------------------------- الأنواع ----------------------------- */
import type { Role } from "@/lib/roles";
export type { Role, Perm } from "@/lib/roles";
export { can, ROLE_LABELS } from "@/lib/roles";

/* ---------------------------- السياق ---------------------------- */
export type Auth = {
  user: { id: number; name: string; email: string };
  role: Role;
  business: { id: number; name: string; type: string };
  memberships: { businessId: number; businessName: string; role: Role }[];
};

export async function getAuth(): Promise<Auth | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const payload = verify(token);
  if (!payload) return null;
  const userId = Number(payload.userId);
  if (!Number.isFinite(userId)) return null;

  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      businessId: usersBusinesses.businessId,
      role: usersBusinesses.role,
      businessName: businesses.name,
      businessType: businesses.type,
    })
    .from(usersBusinesses)
    .innerJoin(users, eq(users.id, usersBusinesses.userId))
    .innerJoin(businesses, eq(businesses.id, usersBusinesses.businessId))
    .where(eq(usersBusinesses.userId, userId));

  if (rows.length === 0) return null;

  const user = { id: rows[0].userId, name: rows[0].name, email: rows[0].email };
  const memberships = rows.map((r) => ({
    businessId: r.businessId,
    businessName: r.businessName,
    businessType: r.businessType,
    role: r.role,
  }));

  const chosenId = Number(payload.businessId);
  const chosen = memberships.find((m) => m.businessId === chosenId) ?? memberships[0];

  return {
    user,
    role: chosen.role,
    business: {
      id: chosen.businessId,
      name: chosen.businessName,
      type: chosen.businessType,
    },
    memberships,
  };
}

export async function requireAuth(): Promise<Auth> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  return auth;
}

/** التحقق من عضوية المستخدم في النشاط (عزل tenants) */
export async function belongsTo(
  businessId: number,
  userId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: usersBusinesses.id })
    .from(usersBusinesses)
    .where(
      and(
        eq(usersBusinesses.businessId, businessId),
        eq(usersBusinesses.userId, userId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
