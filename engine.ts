"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  users,
  businesses,
  usersBusinesses,
  categories,
  units,
  products,
  customers,
  suppliers,
  customerLedger,
  supplierLedger,
  sales,
  saleItems,
  payments,
  purchases,
  purchaseItems,
  returns,
  returnItems,
  cashSessions,
  cashMovements,
  expenses,
  stockMovements,
  activityLog,
} from "@/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { getAuth, setSession, clearSession, can, hashPassword, verifyPassword } from "@/lib/auth";
import type { Auth } from "@/lib/auth";
import { toQ, n, nq, fromQ, fmtMoney, fmtQty } from "@/lib/money";
import { getOpenSession, getStockMap, getCustomerBalances } from "@/lib/queries";

export type Res<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const NOT_LOGGED = { ok: false as const, error: "انتهت الجلسة — سجّل الدخول من جديد." };
const NO_PERM = { ok: false as const, error: "غير مصرح لك بهذه العملية." };

/* ------------------------------ أدوات داخلية ------------------------------ */
async function log(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  auth: Auth,
  action: string,
  summary: string | null,
  refId?: number | null,
  refType?: string | null,
) {
  await tx.insert(activityLog).values({
    businessId: auth.business.id,
    actorId: auth.user.id,
    actorName: auth.user.name,
    action,
    summary,
    refId: refId ?? null,
    refType: refType ?? null,
  });
}

/** خزنة مفتوحة؟ لو لا — نفتح تلقائيًا بمبلغ 0 مع تنبيه (لا نوقف البيع أبدًا) */
async function ensureSession(businessId: number, actorId: number) {
  const open = await getOpenSession(businessId);
  if (open) return open.id;
  const [s] = await db
    .insert(cashSessions)
    .values({
      businessId,
      opening: n(0),
      note: "فتح تلقائي — حدّث مبلغ الفتح من صفحة الخزنة",
      status: "open",
      openedBy: actorId,
    })
    .returning();
  await db.insert(cashMovements).values({
    businessId,
    sessionId: s.id,
    type: "opening",
    amount: n(0),
    note: "فتح تلقائي بدون مبلغ",
    createdBy: actorId,
  });
  return s.id;
}

async function nextNumber(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  table: typeof sales | typeof purchases,
  businessId: number,
): Promise<number> {
  const [r] = await tx
    .select({ m: sql<number>`coalesce(max(${table.number}), 0)::int` })
    .from(table)
    .where(eq(table.businessId, businessId));
  return (r?.m ?? 0) + 1;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/* ------------------------------ الدخول والخروج ------------------------------ */
export async function login(email: string, password: string): Promise<{ ok: false; error: string } | never> {
  const cleanEmail = email.trim().toLowerCase();
  const rows = await db.select().from(users).where(eq(users.email, cleanEmail)).limit(1);
  let user = rows[0];
  if (!user) {
    // تسجيل تلقائي: مفيش حاجة معقدة للتاجر الصغير
    if (!cleanEmail.includes("@") || cleanEmail.length < 5)
      return { ok: false, error: "اكتب بريدًا إلكترونيًا صحيحًا." };
    if (!password || password.length < 4)
      return { ok: false, error: "كلمة المرور 4 أحرف على الأقل." };
    const [u] = await db
      .insert(users)
      .values({
        name: cleanEmail.split("@")[0],
        email: cleanEmail,
        passwordHash: hashPassword(password),
      })
      .returning();
    user = u;
  } else if (!verifyPassword(password, user.passwordHash)) {
    return { ok: false, error: "كلمة المرور غير صحيحة." };
  }
  const mem = await db
    .select()
    .from(usersBusinesses)
    .where(eq(usersBusinesses.userId, user.id))
    .limit(1);
  await setSession(user.id, mem[0]?.businessId ?? 0);
  if (mem.length === 0) redirect("/onboarding");
  redirect("/");
}

export async function demoLogin(userId: number): Promise<{ ok: false; error: string } | never> {
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user[0]) return { ok: false, error: "المستخدم غير موجود." };
  const mem = await db
    .select()
    .from(usersBusinesses)
    .where(eq(usersBusinesses.userId, userId))
    .limit(1);
  await setSession(userId, mem[0]?.businessId ?? 0);
  if (mem.length === 0) redirect("/onboarding");
  redirect("/");
}

export async function logout(): Promise<never> {
  await clearSession();
  redirect("/login");
}

export async function switchBusiness(businessId: number): Promise<Res | never> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const ok = auth.memberships.some((m) => m.businessId === businessId);
  if (!ok) return { ok: false, error: "ليس لديك صلاحية على هذا النشاط." };
  await setSession(auth.user.id, businessId);
  redirect("/");
}

/* ------------------------------ إنشاء النشاط ------------------------------ */
const DEFAULT_CATEGORIES: Record<string, { name: string; emoji: string }[]> = {
  supermarket: [
    { name: "مشروبات", emoji: "🥤" },
    { name: "ألبان", emoji: "🥛" },
    { name: "سناكس", emoji: "🍿" },
    { name: "بقالة", emoji: "🛒" },
    { name: "منظفات", emoji: "🧴" },
    { name: "مجمدات", emoji: "❄️" },
  ],
  attara: [
    { name: "بهارات", emoji: "🌿" },
    { name: "أعشاب", emoji: "🫖" },
    { name: "مكسرات", emoji: "🥜" },
    { name: "توابل", emoji: "🌶️" },
  ],
  general: [
    { name: "ملابس", emoji: "👕" },
    { name: "أحذية", emoji: "👟" },
    { name: "إكسسوارات", emoji: "👜" },
    { name: "أدوات", emoji: "🛠️" },
  ],
};

export async function createBusiness(input: {
  ownerName?: string;
  name: string;
  type: "supermarket" | "attara" | "general";
  hasEmployees: boolean;
  sellsOnCredit: boolean;
  manageInventory: boolean;
  usesBarcode: boolean;
}): Promise<Res | never> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const name = (input.name || "").trim();
  if (!name) return { ok: false, error: "اكتب اسم المحل." };

  const biz = await db.transaction(async (tx) => {
    const [b] = await tx
      .insert(businesses)
      .values({
        name,
        type: input.type,
        hasEmployees: input.hasEmployees,
        sellsOnCredit: input.sellsOnCredit,
        manageInventory: input.manageInventory,
        usesBarcode: input.usesBarcode,
      })
      .returning();
    await tx.insert(usersBusinesses).values({
      userId: auth.user.id,
      businessId: b.id,
      role: "owner",
    });
    for (const [i, c] of (DEFAULT_CATEGORIES[input.type] ?? []).entries()) {
      await tx.insert(categories).values({
        businessId: b.id,
        name: c.name,
        emoji: c.emoji,
        sort: i,
      });
    }
    const unitRows = await tx
      .insert(units)
      .values([
        { businessId: b.id, name: "قطعة", symbol: "قطعة", kind: "piece" },
        { businessId: b.id, name: "كيلو", symbol: "كجم", kind: "kg" },
        { businessId: b.id, name: "جرام", symbol: "جم", kind: "gram" },
        { businessId: b.id, name: "لتر", symbol: "لتر", kind: "liter" },
        { businessId: b.id, name: "كرتونة", symbol: "كرتونة", kind: "carton" },
      ])
      .returning();
    return { id: b.id, unitRows };
  });

  await setSession(auth.user.id, biz.id);
  redirect("/");
}

/* ------------------------------ البيع ------------------------------ */
export type SaleItemIn = { productId?: number; qty: number };

export async function createSale(input: {
  kind: "detailed" | "quick";
  items: SaleItemIn[];
  quickTotal?: number;
  discount?: number;
  method: "cash" | "card" | "wallet" | "credit";
  paidAmount?: number;
  customerId?: number;
  clientRef?: string;
}): Promise<Res<{ sale: Record<string, unknown> }>> {
  const auth = await getAuth();
  if (!auth) return NOT_LOGGED;
  if (!can(auth.role, "sale")) return NO_PERM;
  const businessId = auth.business.id;

  const discount = Math.max(0, Math.round(toQ(input.discount ?? 0))) / 100;
  const clientRef = input.clientRef?.trim() || null;

  // idempotency: نفس العملية من جهاز offline لن تتكرر
  if (clientRef) {
    const existing = await db
      .select()
      .from(sales)
      .where(and(eq(sales.businessId, businessId), eq(sales.clientRef, clientRef)))
      .limit(1);
    if (existing[0]) {
      const s = existing[0];
      const its = await db.select().from(saleItems).where(eq(saleItems.saleId, s.id));
      return {
        ok: true,
        sale: {
          id: s.id,
          number: s.number,
          total: Number(s.total),
          paid: Number(s.paid),
          method: s.method,
          at: s.createdAt.toISOString(),
          items: its.map((i) => ({
            name: i.productName,
            qty: Number(i.qty),
            unitPrice: Number(i.unitPrice),
            total: Number(i.total),
          })),
        },
      };
    }
  }

  // بناء الأصناف من قاعدة البيانات (السيرفر هو مصدر الحقيقة في الأسعار)
  let items: { productId: number | null; name: string; qty: number; unitPrice: number; unitCost: number | null; isWeighted: boolean; total: number }[] = [];
  let itemsTotal = 0;

  if (input.kind === "quick") {
    const total = Math.max(0, toQ(input.quickTotal ?? 0)) / 100;
    if (total <= 0) return { ok: false, error: "اكتب مبلغ البيع." };
    items = [
      {
        productId: null,
        name: "بيع سريع (بدون أصناف)",
        qty: 1,
        unitPrice: total,
        unitCost: null,
        isWeighted: false,
        total,
      },
    ];
    itemsTotal = total;
  } else {
    if (!input.items?.length) return { ok: false, error: "الفاتورة فاضية." };
    const prods = await db
      .select()
      .from(products)
      .where(
        and(
          eq(products.businessId, businessId),
          inArray(products.id, input.items.map((i) => i.productId!).filter(Boolean)),
        ),
      );
    const byId = new Map(prods.map((p) => [p.id, p]));
    for (const it of input.items) {
      if (!it.productId) return { ok: false, error: "صنف بدون معرف." };
      const p = byId.get(it.productId);
      if (!p) return { ok: false, error: "أحد الأصناف غير موجود — حدّث الصفحة." };
      const qty = Number(it.qty);
      if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: "الكمية غير صحيحة." };
      const price = Number(p.salePrice) || 0;
      if (price <= 0) return { ok: false, error: `المنتج «${p.name}» بدون سعر بيع — ضع سعرًا من صفحة المنتجات.` };
      const total = round2(qty * price);
      items.push({
        productId: p.id,
        name: p.name,
        qty,
        unitPrice: price,
        unitCost: p.costPrice !== null ? Number(p.costPrice) : null,
        isWeighted: p.isWeighted,
        total,
      });
      itemsTotal = round2(itemsTotal + total);
    }
  }

  if (discount > itemsTotal) return { ok: false, error: "الخصم أكبر من قيمة الفاتورة." };
  const total = round2(itemsTotal - discount);

  const isCredit = input.method === "credit";
  const paidInput = isCredit ? toQ(input.paidAmount ?? 0) / 100 : total;
  const paid = round2(Math.min(Math.max(0, paidInput), total));
  const remaining = round2(total - paid);

  let customerId: number | null = null;
  if (input.customerId) {
    const c = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, input.customerId), eq(customers.businessId, businessId)))
      .limit(1);
    if (!c[0]) return { ok: false, error: "العميل غير موجود." };
    customerId = c[0].id;
    if (remaining > 0) {
      const balances = await getCustomerBalances(businessId);
      const current = (balances[c[0].id] ?? 0) / 100;
      const limit = Number(c[0].creditLimit) || 0;
      if (limit > 0 && current + remaining > limit) {
        return {
          ok: false,
          error: `رصيد ${c[0].name} ${fmtMoney(current)} وتجاوز حد الائتمان (${fmtMoney(limit)}) ب${fmtMoney(current + remaining - limit)}.`,
        };
      }
    }
  }
  if (remaining > 0 && !customerId) {
    return { ok: false, error: "البيع الآجل يحتاج اختيار عميل." };
  }

  const saleRow = await db.transaction(async (tx) => {
    const num = await nextNumber(tx, sales, businessId);
    const sessionId = await ensureSession(businessId, auth.user.id);
    const [s] = await tx
      .insert(sales)
      .values({
        businessId,
        number: num,
        kind: input.kind,
        customerId,
        status: "completed",
        total: n(toQ(total)),
        discount: n(toQ(discount)),
        paid: n(toQ(paid)),
        method: input.method,
        clientRef,
        createdBy: auth.user.id,
      })
      .returning();

    for (const it of items) {
      await tx.insert(saleItems).values({
        saleId: s.id,
        productId: it.productId,
        productName: it.name,
        qty: nq(it.qty),
        unitPrice: n(toQ(it.unitPrice)),
        unitCost: it.unitCost !== null ? n(toQ(it.unitCost)) : null,
        total: n(toQ(it.total)),
        isWeighted: it.isWeighted,
      });
      if (it.productId) {
        await tx.insert(stockMovements).values({
          businessId,
          productId: it.productId,
          delta: nq(-it.qty),
          reason: "sale",
          refId: s.id,
          refType: "sale",
          note: `بيع — فاتورة رقم ${num}`,
          createdBy: auth.user.id,
        });
      }
    }

    if (paid > 0) {
      await tx.insert(payments).values({
        businessId,
        saleId: s.id,
        amount: n(toQ(paid)),
        method: input.method === "credit" ? "cash" : input.method,
        createdBy: auth.user.id,
      });
      if (input.method === "cash" || (input.method === "credit" && paid > 0)) {
        await tx.insert(cashMovements).values({
          businessId,
          sessionId,
          type: "cash_sale",
          amount: n(toQ(paid)),
          note: `فاتورة رقم ${num}`,
          refId: s.id,
          refType: "sale",
          createdBy: auth.user.id,
        });
      }
    }

    if (remaining > 0 && customerId) {
      await tx.insert(customerLedger).values({
        businessId,
        customerId,
        amount: n(toQ(remaining)),
        kind: "sale",
        refId: s.id,
        refType: "sale",
        note: `فاتورة رقم ${num}`,
        createdBy: auth.user.id,
      });
    }

    await log(tx, auth, "sale_created", `فاتورة رقم ${num} — ${fmtMoney(total)} (${input.method === "credit" ? "آجل" : "مدفوع"})`, s.id, "sale");
    return s;
  });

  revalidatePath("/", "layout");
  return {
    ok: true,
    sale: {
      id: saleRow.id,
      number: saleRow.number,
      total,
      paid,
      method: input.method,
      at: saleRow.createdAt.toISOString(),
      items: items.map((i) => ({
        name: i.name,
        qty: i.qty,
        unitPrice: i.unitPrice,
        total: i.total,
        isWeighted: i.isWeighted,
      })),
    },
  };
}

/* ------------------------------ إلغاء فاتورة ------------------------------ */
export async function voidSale(saleId: number, reason: string): Promise<Res> {
  const auth = await getAuth();
  if (!auth) return NOT_LOGGED;
  if (!can(auth.role, "void_sale")) return NO_PERM;
  const businessId = auth.business.id;

  const rows = await db
    .select()
    .from(sales)
    .where(and(eq(sales.id, saleId), eq(sales.businessId, businessId)))
    .limit(1);
  const s = rows[0];
  if (!s) return { ok: false, error: "الفاتورة غير موجودة." };
  if (s.status === "voided") return { ok: false, error: "الفاتورة ملغاة بالفعل." };
  const rets = await db.select().from(returns).where(eq(returns.saleId, saleId)).limit(1);
  if (rets.length > 0) return { ok: false, error: "يوجد مرتجع لهذه الفاتورة — لا يمكن إلغاؤها." };

  const its = await db.select().from(saleItems).where(eq(saleItems.saleId, saleId));

  await db.transaction(async (tx) => {
    await tx
      .update(sales)
      .set({ status: "voided", voidedAt: new Date(), voidReason: reason || null })
      .where(eq(sales.id, saleId));
    for (const it of its) {
      if (it.productId) {
        await tx.insert(stockMovements).values({
          businessId,
          productId: it.productId,
          delta: nq(Number(it.qty)),
          reason: "void",
          refId: s.id,
          refType: "sale",
          note: `إلغاء فاتورة رقم ${s.number}`,
          createdBy: auth.user.id,
        });
      }
    }
    const paid = toQ(s.paid) / 100;
    if (paid > 0) {
      await tx
        .update(payments)
        .set({ voided: true })
        .where(eq(payments.saleId, saleId));
      if (s.method === "cash") {
        const sessionId = await ensureSession(businessId, auth.user.id);
        await tx.insert(cashMovements).values({
          businessId,
          sessionId,
          type: "adjustment",
          amount: n(-toQ(paid)),
          note: `إلغاء فاتورة رقم ${s.number}`,
          refId: s.id,
          refType: "sale",
          createdBy: auth.user.id,
        });
      }
    }
    const remaining = (toQ(s.total) - toQ(s.paid)) / 100;
    if (remaining > 0 && s.customerId) {
      await tx.insert(customerLedger).values({
        businessId,
        customerId: s.customerId,
        amount: n(-toQ(remaining)),
        kind: "void",
        refId: s.id,
        refType: "sale",
        note: `إلغاء فاتورة رقم ${s.number}`,
        createdBy: auth.user.id,
      });
    }
    await log(tx, auth, "sale_voided", `ألغى الفاتورة رقم ${s.number} — ${fmtMoney(s.total)}${reason ? ` (السبب: ${reason})` : ""}`, s.id, "sale");
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/* ------------------------------ مرتجع بيع ------------------------------ */
export async function returnSale(input: {
  saleId: number;
  items: { saleItemId: number; qty: number }[];
  refundMethod: "cash" | "card" | "wallet" | "credit";
  note?: string;
}): Promise<Res<{ total: number }>> {
  const auth = await getAuth();
  if (!auth) return NOT_LOGGED;
  if (!can(auth.role, "return_sale")) return NO_PERM;
  const businessId = auth.business.id;

  const rows = await db
    .select()
    .from(sales)
    .where(and(eq(sales.id, input.saleId), eq(sales.businessId, businessId)))
    .limit(1);
  const s = rows[0];
  if (!s) return { ok: false, error: "الفاتورة غير موجودة." };
  if (s.status !== "completed") return { ok: false, error: "لا يمكن عمل مرتجع لفاتورة ملغاة." };
  if (!input.items?.length) return { ok: false, error: "اختر الأصناف المرتجعة." };

  const its = await db.select().from(saleItems).where(eq(saleItems.saleId, s.id));
  const prevRets = await db.select().from(returnItems).leftJoin(returns, eq(returns.id, returnItems.returnId)).where(eq(returns.saleId, s.id));

  let total = 0;
  const chosen: { saleItemId: number; item: (typeof its)[number]; qty: number }[] = [];
  for (const r of input.items) {
    const it = its.find((i) => i.id === r.saleItemId);
    if (!it) return { ok: false, error: "صنف غير موجود في الفاتورة." };
    const already = prevRets
      .filter((x) => x.return_items.saleItemId === it.id)
      .reduce((sum, x) => sum + Number(x.return_items.qty), 0);
    const qty = Number(r.qty);
    if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: "كمية غير صحيحة." };
    if (qty + already > Number(it.qty) + 1e-9) {
      return { ok: false, error: `كمية ${it.productName} أكبر من المباع.` };
    }
    chosen.push({ saleItemId: it.id, item: it, qty });
    total = round2(total + qty * Number(it.unitPrice));
  }

  await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(returns)
      .values({
        businessId,
        saleId: s.id,
        customerId: s.customerId,
        total: n(toQ(total)),
        refundMethod: input.refundMethod,
        note: input.note || null,
        createdBy: auth.user.id,
      })
      .returning();
    for (const c of chosen) {
      await tx.insert(returnItems).values({
        returnId: r.id,
        saleItemId: c.saleItemId,
        productId: c.item.productId,
        productName: c.item.productName,
        qty: nq(c.qty),
        unitPrice: c.item.unitPrice,
        total: n(toQ(c.qty * Number(c.item.unitPrice))),
      });
      if (c.item.productId) {
        await tx.insert(stockMovements).values({
          businessId,
          productId: c.item.productId,
          delta: nq(c.qty),
          reason: "sale_return",
          refId: r.id,
          refType: "return",
          note: `مرتجع فاتورة رقم ${s.number}`,
          createdBy: auth.user.id,
        });
      }
    }
    if (input.refundMethod === "cash") {
      const sessionId = await ensureSession(businessId, auth.user.id);
      await tx.insert(cashMovements).values({
        businessId,
        sessionId,
        type: "sale_refund",
        amount: n(-toQ(total)),
        note: `مرتجع فاتورة رقم ${s.number}`,
        refId: r.id,
        refType: "return",
        createdBy: auth.user.id,
      });
    }
    if (s.method === "credit" && s.customerId) {
      await tx.insert(customerLedger).values({
        businessId,
        customerId: s.customerId,
        amount: n(-toQ(total)),
        kind: "return",
        refId: r.id,
        refType: "return",
        note: `مرتجع فاتورة رقم ${s.number}`,
        createdBy: auth.user.id,
      });
    }
    await log(tx, auth, "sale_return", `مرتجع ${fmtMoney(total)} من الفاتورة رقم ${s.number}`, r.id, "return");
  });
  revalidatePath("/", "layout");
  return { ok: true, total };
}

/* ------------------------------ الشراء ------------------------------ */
export async function createPurchase(input: {
  supplierId?: number;
  items: { productId?: number; name?: string; qty: number; unitCost: number }[];
  paid: number;
  note?: string;
}): Promise<Res<{ id: number }>> {
  const auth = await getAuth();
  if (!auth) return NOT_LOGGED;
  if (!can(auth.role, "purchases")) return NO_PERM;
  const businessId = auth.business.id;

  let supplierId: number | null = null;
  if (input.supplierId) {
    const sup = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.businessId, businessId)))
      .limit(1);
    if (!sup[0]) return { ok: false, error: "المورد غير موجود." };
    supplierId = sup[0].id;
  }

  const items = (input.items ?? []).filter((i) => i.qty > 0);
  if (items.length === 0) return { ok: false, error: "أضف صنفًا واحدًا على الأقل أو استخدم شراء سريع بدون أصناف." };

  let total = 0;
  const resolved: { productId: number | null; name: string; qty: number; unitCost: number; total: number }[] = [];
  for (const it of items) {
    const cost = Math.max(0, it.unitCost || 0);
    const lineTotal = round2(it.qty * cost);
    total = round2(total + lineTotal);
    resolved.push({
      productId: it.productId ?? null,
      name: it.name ?? "صنف",
      qty: it.qty,
      unitCost: cost,
      total: lineTotal,
    });
  }
  const paid = round2(Math.min(Math.max(0, input.paid || 0), total));

  const id = await db.transaction(async (tx) => {
    const num = await nextNumber(tx, purchases, businessId);
    const [p] = await tx
      .insert(purchases)
      .values({
        businessId,
        number: num,
        supplierId,
        total: n(toQ(total)),
        paid: n(toQ(paid)),
        note: input.note || null,
        createdBy: auth.user.id,
      })
      .returning();
    for (const it of resolved) {
      await tx.insert(purchaseItems).values({
        purchaseId: p.id,
        productId: it.productId,
        productName: it.name,
        qty: nq(it.qty),
        unitCost: n(toQ(it.unitCost)),
        total: n(toQ(it.total)),
      });
      if (it.productId) {
        await tx.insert(stockMovements).values({
          businessId,
          productId: it.productId,
          delta: nq(it.qty),
          reason: "purchase",
          refId: p.id,
          refType: "purchase",
          note: `شراء رقم ${num}`,
          createdBy: auth.user.id,
        });
        await tx
          .update(products)
          .set({ costPrice: n(toQ(it.unitCost)), updatedAt: new Date() })
          .where(eq(products.id, it.productId));
      }
    }
    if (supplierId) {
      await tx.insert(supplierLedger).values({
        businessId,
        supplierId,
        amount: n(toQ(total)),
        kind: "purchase",
        refId: p.id,
        refType: "purchase",
        note: `شراء رقم ${num}`,
        createdBy: auth.user.id,
      });
    }
    if (paid > 0) {
      const sessionId = await ensureSession(businessId, auth.user.id);
      await tx.insert(cashMovements).values({
        businessId,
        sessionId,
        type: "cash_purchase",
        amount: n(-toQ(paid)),
        note: `شراء رقم ${num}`,
        refId: p.id,
        refType: "purchase",
        createdBy: auth.user.id,
      });
    }
    await log(
      tx,
      auth,
      "purchase_created",
      `شراء رقم ${num} — ${fmtMoney(total)} (مدفوع ${fmtMoney(paid)}${supplierId ? "، آجل لدى المورد" : ""})`,
      p.id,
      "purchase",
    );
    return p.id;
  });
  revalidatePath("/", "layout");
  return { ok: true, id };
}

/* ------------------------------ المشتريات/المدفوعات ------------------------------ */
export async function recordExpense(input: {
  amount: number;
  category: string;
  note?: string;
}): Promise<Res> {
  const auth = await getAuth();
  if (!auth) return NOT_LOGGED;
  if (!can(auth.role, "expenses")) return NO_PERM;
  const amount = toQ(input.amount) / 100;
  if (amount <= 0) return { ok: false, error: "المبلغ غير صحيح." };
  const businessId = auth.business.id;
  await db.transaction(async (tx) => {
    await tx.insert(expenses).values({
      businessId,
      amount: n(toQ(amount)),
      category: input.category || "أخرى",
      note: input.note || null,
      createdBy: auth.user.id,
    });
    const sessionId = await ensureSession(businessId, auth.user.id);
    await tx.insert(cashMovements).values({
      businessId,
      sessionId,
      type: "expense",
      amount: n(-toQ(amount)),
      note: `${input.category || "أخرى"}${input.note ? ` — ${input.note}` : ""}`,
      createdBy: auth.user.id,
    });
    await log(tx, auth, "expense_recorded", `مصروف ${input.category || "أخرى"} — ${fmtMoney(amount)}${input.note ? ` (${input.note})` : ""}`);
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function recordCustomerPayment(input: {
  customerId: number;
  amount: number;
  note?: string;
}): Promise<Res<{ newBalance: number }>> {
  const auth = await getAuth();
  if (!auth) return NOT_LOGGED;
  if (!can(auth.role, "expenses")) return NO_PERM;
  const amount = toQ(input.amount) / 100;
  if (amount <= 0) return { ok: false, error: "المبلغ غير صحيح." };
  const businessId = auth.business.id;
  const c = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.businessId, businessId)))
    .limit(1);
  if (!c[0]) return { ok: false, error: "العميل غير موجود." };

  await db.transaction(async (tx) => {
    await tx.insert(customerLedger).values({
      businessId,
      customerId: input.customerId,
      amount: n(-toQ(amount)),
      kind: "payment",
      refId: null,
      refType: "customer_payment",
      note: input.note || null,
      createdBy: auth.user.id,
    });
    await tx.insert(payments).values({
      businessId,
      amount: n(toQ(amount)),
      method: "cash",
      note: `تحصيل من ${c[0].name}`,
      createdBy: auth.user.id,
    });
    const sessionId = await ensureSession(businessId, auth.user.id);
    await tx.insert(cashMovements).values({
      businessId,
      sessionId,
      type: "collection",
      amount: n(toQ(amount)),
      note: `تحصيل من ${c[0].name}${input.note ? ` — ${input.note}` : ""}`,
      createdBy: auth.user.id,
    });
    await log(tx, auth, "customer_payment", `قبض ${fmtMoney(amount)} من ${c[0].name}`, input.customerId, "customer");
  });
  const balances = await getCustomerBalances(businessId);
  revalidatePath("/", "layout");
  return { ok: true, newBalance: (balances[input.customerId] ?? 0) / 100 };
}

export async function recordSupplierPayment(input: {
  supplierId: number;
  amount: number;
  note?: string;
}): Promise<Res> {
  const auth = await getAuth();
  if (!auth) return NOT_LOGGED;
  if (!can(auth.role, "purchases")) return NO_PERM;
  const amount = toQ(input.amount) / 100;
  if (amount <= 0) return { ok: false, error: "المبلغ غير صحيح." };
  const businessId = auth.business.id;
  const s = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.businessId, businessId)))
    .limit(1);
  if (!s[0]) return { ok: false, error: "المورد غير موجود." };

  await db.transaction(async (tx) => {
    await tx.insert(supplierLedger).values({
      businessId,
      supplierId: input.supplierId,
      amount: n(-toQ(amount)),
      kind: "payment",
      refId: null,
      refType: "supplier_payment",
      note: input.note || null,
      createdBy: auth.user.id,
    });
    const sessionId = await ensureSession(businessId, auth.user.id);
    await tx.insert(cashMovements).values({
      businessId,
      sessionId,
      type: "supplier_payment",
      amount: n(-toQ(amount)),
      note: `دفع إلى ${s[0].name}${input.note ? ` — ${input.note}` : ""}`,
      createdBy: auth.user.id,
    });
    await log(tx, auth, "supplier_payment", `دفع ${fmtMoney(amount)} إلى ${s[0].name}`, input.supplierId, "supplier");
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function cashIn(input: { amount: number; note?: string }): Promise<Res> {
  const auth = await getAuth();
  if (!auth) return NOT_LOGGED;
  if (!can(auth.role, "cash")) return NO_PERM;
  const amount = toQ(input.amount) / 100;
  if (amount <= 0) return { ok: false, error: "المبلغ غير صحيح." };
  const businessId = auth.business.id;
  await db.transaction(async (tx) => {
    const sessionId = await ensureSession(businessId, auth.user.id);
    await tx.insert(cashMovements).values({
      businessId,
      sessionId,
      type: "other_in",
      amount: n(toQ(amount)),
      note: input.note || "إيراد آخر",
      createdBy: auth.user.id,
    });
    await log(tx, auth, "cash_in", `إيراد آخر +${fmtMoney(amount)}${input.note ? ` (${input.note})` : ""}`);
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function cashOut(input: { amount: number; note?: string }): Promise<Res> {
  const auth = await getAuth();
  if (!auth) return NOT_LOGGED;
  if (!can(auth.role, "cash")) return NO_PERM;
  const amount = toQ(input.amount) / 100;
  if (amount <= 0) return { ok: false, error: "المبلغ غير صحيح." };
  const businessId = auth.business.id;
  await db.transaction(async (tx) => {
    const sessionId = await ensureSession(businessId, auth.user.id);
    await tx.insert(cashMovements).values({
      businessId,
      sessionId,
      type: "withdrawal",
      amount: n(-toQ(amount)),
      note: input.note || "سحب من الخزنة",
      createdBy: auth.user.id,
    });
    await log(tx, auth, "cash_out", `سحب من الخزنة -${fmtMoney(amount)}${input.note ? ` (${input.note})` : ""}`);
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/* ------------------------------ الخزنة ------------------------------ */
export async function openCashSession(input: { opening: number; note?: string }): Promise<Res> {
  const auth = await getAuth();
  if (!auth) return NOT_LOGGED;
  if (!can(auth.role, "cash")) return NO_PERM;
  const businessId = auth.business.id;
  const open = await getOpenSession(businessId);
  if (open) return { ok: false, error: "الخزنة مفتوحة بالفعل — أقفل اليوم أولًا." };
  const opening = Math.max(0, toQ(input.opening) / 100);
  await db.transaction(async (tx) => {
    const [s] = await tx
      .insert(cashSessions)
      .values({
        businessId,
        opening: n(toQ(opening)),
        note: input.note || null,
        status: "open",
        openedBy: auth.user.id,
      })
      .returning();
    await tx.insert(cashMovements).values({
      businessId,
      sessionId: s.id,
      type: "opening",
      amount: n(toQ(opening)),
      note: "فتح الخزنة",
      createdBy: auth.user.id,
    });
    await log(tx, auth, "cash_opened", `فتح الخزنة بمبلغ ${fmtMoney(opening)}`);
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function closeCashSession(input: {
  actual: number;
  note?: string;
}): Promise<Res<{ expected: number; actual: number; variance: number }>> {
  const auth = await getAuth();
  if (!auth) return NOT_LOGGED;
  if (!can(auth.role, "cash")) return NO_PERM;
  const businessId = auth.business.id;
  const open = await getOpenSession(businessId);
  if (!open) return { ok: false, error: "لا توجد خزنة مفتوحة." };
  const actual = toQ(input.actual) / 100;
  const variance = round2(actual - open.expected);

  await db.transaction(async (tx) => {
    await tx
      .update(cashSessions)
      .set({
        status: "closed",
        closedAt: new Date(),
        expected: n(toQ(open.expected)),
        actual: n(toQ(actual)),
        variance: n(toQ(variance)),
        closeNote: input.note || null,
        closedBy: auth.user.id,
      })
      .where(eq(cashSessions.id, open.id));
    await log(
      tx,
      auth,
      "cash_closed",
      `إقفال اليوم — المتوقع ${fmtMoney(open.expected)}، الفعلي ${fmtMoney(actual)}، الفرق ${fmtMoney(Math.abs(variance))}${variance < 0 ? " (عجز)" : variance > 0 ? " (زيادة)" : ""}`,
      open.id,
      "cash_session",
    );
  });
  revalidatePath("/", "layout");
  return { ok: true, expected: open.expected, actual, variance };
}

export async function recordCashAdjustment(input: {
  amount: number;
  note?: string;
}): Promise<Res> {
  const auth = await getAuth();
  if (!auth) return NOT_LOGGED;
  if (!can(auth.role, "cash")) return NO_PERM;
  const businessId = auth.business.id;
  const amount = toQ(input.amount) / 100;
  if (amount === 0) return { ok: false, error: "المبلغ غير صحيح." };
  await db.transaction(async (tx) => {
    const sessionId = await ensureSession(businessId, auth.user.id);
    await tx.insert(cashMovements).values({
      businessId,
      sessionId,
      type: "adjustment",
      amount: n(toQ(amount)),
      note: input.note || "تسوية خزنة",
      createdBy: auth.user.id,
    });
    await log(tx, auth, "cash_adjustment", `تسوية خزنة ${amount > 0 ? "+" : ""}${fmtMoney(amount)}${input.note ? ` (${input.note})` : ""}`);
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/* ------------------------------ المنتجات ------------------------------ */
export async function createProduct(input: {
  name: string;
  salePrice: number;
  costPrice?: number;
  unitId: number;
  categoryId?: number;
  isWeighted?: boolean;
  barcode?: string;
  reorderPoint?: number;
  openingQty?: number;
  parentId?: number;
}): Promise<Res<{ product: { id: number; name: string; salePrice: number } }>> {
  const auth = await getAuth();
  if (!auth) return NOT_LOGGED;
  if (!can(auth.role, "products")) return NO_PERM;
  const businessId = auth.business.id;
  const name = (input.name || "").trim();
  if (!name) return { ok: false, error: "اكتب اسم المنتج." };
  if (!(input.salePrice > 0)) return { ok: false, error: "سعر البيع مطلوب." };

  let categoryId: number | null = null;
  if (input.categoryId) {
    const c = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, input.categoryId), eq(categories.businessId, businessId)))
      .limit(1);
    if (!c[0]) return { ok: false, error: "الفئة غير موجودة." };
    categoryId = c[0].id;
  }

  // الوحدة يجب أن تخص هذا النشاط — وإلا نستخدم أول وحدة متاحة
  const unitRows = await db
    .select()
    .from(units)
    .where(eq(units.businessId, businessId))
    .limit(20);
  const validUnit = unitRows.find((u) => u.id === input.unitId);
  const unitId = (validUnit ?? unitRows.find((u) => u.kind === "piece") ?? unitRows[0])?.id;
  if (!unitId) return { ok: false, error: "لا توجد وحدات قياس — أنشئ النشاط من جديد." };

  const product = await db.transaction(async (tx) => {
    const [p] = await tx
      .insert(products)
      .values({
        businessId,
        name,
        categoryId,
        unitId,
        salePrice: n(toQ(input.salePrice)),
        costPrice: input.costPrice !== undefined && input.costPrice !== null ? n(toQ(input.costPrice)) : null,
        isWeighted: input.isWeighted ?? false,
        barcode: input.barcode?.trim() || null,
        reorderPoint: nq(input.reorderPoint ?? 0),
        parentId: input.parentId ?? null,
      })
      .returning();
    const openingQty = Number(input.openingQty) || 0;
    if (openingQty > 0) {
      await tx.insert(stockMovements).values({
        businessId,
        productId: p.id,
        delta: nq(openingQty),
        reason: "opening",
        note: "رصيد افتتاحي",
        createdBy: auth.user.id,
      });
    }
    await log(tx, auth, "product_created", `أضاف المنتج «${name}» بسعر ${fmtMoney(input.salePrice)}`, p.id, "product");
    return p;
  });
  revalidatePath("/", "layout");
  return { ok: true, product: { id: product.id, name: product.name, salePrice: Number(product.salePrice) } };
}

export async function updateProduct(input: {
  id: number;
  name?: string;
  salePrice?: number;
  costPrice?: number | null;
  reorderPoint?: number;
  barcode?: string | null;
}): Promise<Res> {
  const auth = await getAuth();
  if (!auth) return NOT_LOGGED;
  if (!can(auth.role, "products")) return NO_PERM;
  const businessId = auth.business.id;
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.id, input.id), eq(products.businessId, businessId)))
    .limit(1);
  const p = rows[0];
  if (!p) return { ok: false, error: "المنتج غير موجود." };
  const changes: string[] = [];
  if (input.name && input.name.trim() !== p.name) changes.push(`الاسم → «${input.name.trim()}»`);
  if (input.salePrice !== undefined && toQ(input.salePrice) !== toQ(p.salePrice))
    changes.push(`السعر → ${fmtMoney(input.salePrice)}`);
  if (input.costPrice !== undefined && input.costPrice !== null && toQ(input.costPrice) !== toQ(p.costPrice))
    changes.push(`التكلفة → ${fmtMoney(input.costPrice)}`);
  if (input.reorderPoint !== undefined) changes.push(`حد إعادة الطلب → ${fmtQty(input.reorderPoint)}`);
  await db
    .update(products)
    .set({
      name: input.name?.trim() || p.name,
      salePrice: input.salePrice !== undefined ? n(toQ(input.salePrice)) : p.salePrice,
      costPrice: input.costPrice === null ? null : input.costPrice !== undefined ? n(toQ(input.costPrice)) : p.costPrice,
      reorderPoint: input.reorderPoint !== undefined ? nq(input.reorderPoint) : p.reorderPoint,
      barcode: input.barcode !== undefined ? input.barcode?.trim() || null : p.barcode,
      updatedAt: new Date(),
    })
    .where(eq(products.id, input.id));
  await db.insert(activityLog).values({
    businessId,
    actorId: auth.user.id,
    actorName: auth.user.name,
    action: "product_updated",
    summary: `عدّل «${p.name}»: ${changes.join("، ") || "بدون تغيير"}`,
    refId: p.id,
    refType: "product",
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function adjustStock(input: {
  productId: number;
  newQty: number;
  note?: string;
}): Promise<Res> {
  const auth = await getAuth();
  if (!auth) return NOT_LOGGED;
  if (!can(auth.role, "products")) return NO_PERM;
  const businessId = auth.business.id;
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.id, input.productId), eq(products.businessId, businessId)))
    .limit(1);
  if (!rows[0]) return { ok: false, error: "المنتج غير موجود." };
  const stock = await getStockMap(businessId);
  const current = stock[input.productId] ?? 0;
  const newQty = Number(input.newQty);
  if (!Number.isFinite(newQty) || newQty < 0) return { ok: false, error: "الكمية غير صحيحة." };
  const delta = round2(newQty - current);
  if (Math.abs(delta) < 1e-9) return { ok: false, error: "لا يوجد فرق — الكمية كما هي." };

  await db.transaction(async (tx) => {
    await tx.insert(stockMovements).values({
      businessId,
      productId: input.productId,
      delta: nq(delta),
      reason: "adjustment",
      note: input.note || "تسوية جرد",
      createdBy: auth.user.id,
    });
    await log(
      tx,
      auth,
      "stock_adjusted",
      `جرد «${rows[0].name}»: ${fmtQty(current)} ← ${fmtQty(newQty)} (فرق ${delta > 0 ? "+" : ""}${fmtQty(delta)})`,
      input.productId,
      "product",
    );
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/* ------------------------------ العملاء والموردون ------------------------------ */
export async function createCustomer(input: {
  name: string;
  phone?: string;
  creditLimit?: number;
}): Promise<Res<{ customer: { id: number; name: string } }>> {
  const auth = await getAuth();
  if (!auth) return NOT_LOGGED;
  const name = (input.name || "").trim();
  if (!name) return { ok: false, error: "اكتب اسم العميل." };
  const businessId = auth.business.id;
  const [c] = await db
    .insert(customers)
    .values({
      businessId,
      name,
      phone: input.phone?.trim() || null,
      creditLimit: input.creditLimit ? n(toQ(input.creditLimit)) : null,
    })
    .returning();
  await db.insert(activityLog).values({
    businessId,
    actorId: auth.user.id,
    actorName: auth.user.name,
    action: "customer_created",
    summary: `أضاف العميل «${name}»`,
    refId: c.id,
    refType: "customer",
  });
  revalidatePath("/", "layout");
  return { ok: true, customer: { id: c.id, name: c.name } };
}

export async function createSupplier(input: {
  name: string;
  phone?: string;
}): Promise<Res<{ supplier: { id: number; name: string } }>> {
  const auth = await getAuth();
  if (!auth) return NOT_LOGGED;
  const name = (input.name || "").trim();
  if (!name) return { ok: false, error: "اكتب اسم المورد." };
  const businessId = auth.business.id;
  const [s] = await db
    .insert(suppliers)
    .values({ businessId, name, phone: input.phone?.trim() || null })
    .returning();
  await db.insert(activityLog).values({
    businessId,
    actorId: auth.user.id,
    actorName: auth.user.name,
    action: "supplier_created",
    summary: `أضاف المورد «${name}»`,
    refId: s.id,
    refType: "supplier",
  });
  revalidatePath("/", "layout");
  return { ok: true, supplier: { id: s.id, name: s.name } };
}

/* ------------------------------ الموظفون ------------------------------ */
export async function createEmployee(input: {
  name: string;
  email: string;
  password: string;
  role: "manager" | "cashier" | "inventory";
}): Promise<Res> {
  const auth = await getAuth();
  if (!auth) return NOT_LOGGED;
  if (!can(auth.role, "employees")) return NO_PERM;
  const businessId = auth.business.id;
  const name = (input.name || "").trim();
  const email = (input.email || "").trim().toLowerCase();
  if (!name || !email || !input.password) return { ok: false, error: "اكمل البيانات المطلوبة." };

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  let userId: number;
  if (existing[0]) {
    const linked = await db
      .select()
      .from(usersBusinesses)
      .where(and(eq(usersBusinesses.userId, existing[0].id), eq(usersBusinesses.businessId, businessId)))
      .limit(1);
    if (linked[0]) return { ok: false, error: "هذا المستخدم مضاف بالفعل." };
    userId = existing[0].id;
  } else {
    const [u] = await db
      .insert(users)
      .values({ name, email, passwordHash: hashPassword(input.password) })
      .returning();
    userId = u.id;
  }
  await db.insert(usersBusinesses).values({ userId, businessId, role: input.role });
  await db.insert(activityLog).values({
    businessId,
    actorId: auth.user.id,
    actorName: auth.user.name,
    action: "employee_added",
    summary: `أضاف ${name} بدور ${input.role}`,
    refId: userId,
    refType: "user",
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateEmployeeRole(membershipId: number, role: "owner" | "manager" | "cashier" | "inventory"): Promise<Res> {
  const auth = await getAuth();
  if (!auth) return NOT_LOGGED;
  if (!can(auth.role, "employees")) return NO_PERM;
  const businessId = auth.business.id;
  await db
    .update(usersBusinesses)
    .set({ role })
    .where(and(eq(usersBusinesses.id, membershipId), eq(usersBusinesses.businessId, businessId)));
  await db.insert(activityLog).values({
    businessId,
    actorId: auth.user.id,
    actorName: auth.user.name,
    action: "employee_role_changed",
    summary: `غيّر صلاحية موظف إلى ${role}`,
    refId: membershipId,
    refType: "membership",
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeEmployee(membershipId: number): Promise<Res> {
  const auth = await getAuth();
  if (!auth) return NOT_LOGGED;
  if (!can(auth.role, "employees")) return NO_PERM;
  const businessId = auth.business.id;
  const rows = await db
    .select()
    .from(usersBusinesses)
    .where(and(eq(usersBusinesses.id, membershipId), eq(usersBusinesses.businessId, businessId)))
    .limit(1);
  if (!rows[0]) return { ok: false, error: "غير موجود." };
  if (rows[0].userId === auth.user.id) return { ok: false, error: "لا يمكنك إزالة نفسك من النشاط." };
  await db.delete(usersBusinesses).where(eq(usersBusinesses.id, membershipId));
  await db.insert(activityLog).values({
    businessId,
    actorId: auth.user.id,
    actorName: auth.user.name,
    action: "employee_removed",
    summary: "أزال موظفًا من النشاط",
    refId: rows[0].userId,
    refType: "user",
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

void fromQ;
