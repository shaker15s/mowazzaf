import { db } from "@/db";
import {
  sales,
  saleItems,
  payments,
  purchases,
  expenses,
  customers,
  suppliers,
  customerLedger,
  supplierLedger,
  products,
  categories,
  units,
  cashSessions,
  cashMovements,
  stockMovements,
  activityLog,
  users,
  returns,
  purchaseItems,
  businesses,
  usersBusinesses,
} from "@/db/schema";
import { sql, eq, and, gte, lt, desc, asc, inArray, isNull } from "drizzle-orm";
import { fromQ, toQ, fmtMoney, fmtQty, fmtDateShort, CASH_TYPE_LABELS } from "@/lib/money";
import type { Role } from "@/lib/auth";

/* ------------------------------ الوقت (بتوقيت القاهرة) ------------------------------ */
export function cairoNow(): Date {
  return new Date();
}

/** بداية ونهاية "اليوم" بتوقيت القاهرة — بدون تحليل نصي للتواريخ */
export function dayBounds(date: Date = new Date()): { start: Date; end: Date } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  // وقت الجدار في القاهرة معاملًا كـ UTC مؤقتًا
  const wallMs = Date.UTC(
    g("year"),
    g("month") - 1,
    g("day"),
    g("hour"),
    g("minute"),
    g("second"),
  );
  // الإزاحة الفعلية = الفرق بين الجدار والفعلي، مقرّبة لأقرب ساعة (القاهرة +2/+3)
  const offsetMin = Math.round((wallMs - date.getTime()) / 60000 / 60) * 60;
  // منتصف ليل القاهرة (بتوقيت الجدار) − الإزاحة = اللحظة الفعلية لبداية اليوم
  const dayWallMs = Date.UTC(g("year"), g("month") - 1, g("day"), 0, 0, 0);
  const start = new Date(dayWallMs - offsetMin * 60000);
  return { start, end: new Date(start.getTime() + 86400_000) };
}

export function cairoHour(date: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Cairo",
      hour: "2-digit",
      hour12: false,
    }).format(date),
  );
}

/* ------------------------------ تجميعات عامة ------------------------------ */
const SUMF = (col: Parameters<typeof sql>[0] extends never ? never : any) => col;

export async function getStockMap(businessId: number): Promise<Record<number, number>> {
  const rows = await db
    .select({
      productId: stockMovements.productId,
      qty: sql<number>`coalesce(sum(${stockMovements.delta}), 0)::float8`,
    })
    .from(stockMovements)
    .where(eq(stockMovements.businessId, businessId))
    .groupBy(stockMovements.productId);
  const map: Record<number, number> = {};
  for (const r of rows) map[r.productId] = r.qty;
  return map;
}

export async function getCustomerBalances(businessId: number): Promise<Record<number, number>> {
  const rows = await db
    .select({
      customerId: customerLedger.customerId,
      balance: sql<number>`coalesce(sum(${customerLedger.amount}), 0)::float8`,
    })
    .from(customerLedger)
    .where(eq(customerLedger.businessId, businessId))
    .groupBy(customerLedger.customerId);
  const map: Record<number, number> = {};
  for (const r of rows) map[r.customerId] = r.balance;
  return map;
}

export async function getSupplierBalances(businessId: number): Promise<Record<number, number>> {
  const rows = await db
    .select({
      supplierId: supplierLedger.supplierId,
      balance: sql<number>`coalesce(sum(${supplierLedger.amount}), 0)::float8`,
    })
    .from(supplierLedger)
    .where(eq(supplierLedger.businessId, businessId))
    .groupBy(supplierLedger.supplierId);
  const map: Record<number, number> = {};
  for (const r of rows) map[r.supplierId] = r.balance;
  return map;
}

export type OpenSession = { id: number; opening: number; openedAt: Date; expected: number } | null;

export async function getOpenSession(businessId: number): Promise<OpenSession> {
  const rows = await db
    .select()
    .from(cashSessions)
    .where(and(eq(cashSessions.businessId, businessId), eq(cashSessions.status, "open")))
    .orderBy(desc(cashSessions.id))
    .limit(1);
  if (rows.length === 0) return null;
  const s = rows[0];
  const [{ sum }] = await db
    .select({ sum: sql<number>`coalesce(sum(${cashMovements.amount}), 0)::float8` })
    .from(cashMovements)
    .where(
      and(
        eq(cashMovements.businessId, businessId),
        eq(cashMovements.sessionId, s.id),
      ),
    );
  return { id: s.id, opening: toQ(s.opening) / 100, openedAt: s.openedAt, expected: (sum ?? 0) / 100 };
}

export async function getLastClosedSession(businessId: number) {
  const rows = await db
    .select()
    .from(cashSessions)
    .where(and(eq(cashSessions.businessId, businessId), eq(cashSessions.status, "closed")))
    .orderBy(desc(cashSessions.id))
    .limit(1);
  return rows[0] ?? null;
}

/* ------------------------------ التنبيهات ------------------------------ */
export type Alert = {
  id: string;
  type: "stock" | "cash" | "debt" | "session" | "variance";
  severity: "info" | "warn" | "danger";
  title: string;
  body?: string;
  href?: string;
};

export async function getAlerts(businessId: number): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const stock = await getStockMap(businessId);
  const prods = await db
    .select()
    .from(products)
    .where(and(eq(products.businessId, businessId), eq(products.archived, false)));
  for (const p of prods) {
    const q = stock[p.id] ?? 0;
    const rp = Number(p.reorderPoint) || 0;
    if (q < 0) {
      alerts.push({
        id: `neg-${p.id}`,
        type: "stock",
        severity: "danger",
        title: `${p.name}: الكمية سالبة (${fmtQty(q)})`,
        body: "بيع بكمية أكبر من المسجل في المخزون — راجع المخزون أو سجّل شراء.",
        href: "/products",
      });
    } else if (rp > 0 && q <= rp) {
      alerts.push({
        id: `low-${p.id}`,
        type: "stock",
        severity: "warn",
        title: `${p.name} قرب يخلص`,
        body: `المخزون ${fmtQty(q)} وحد إعادة الطلب ${fmtQty(rp)}`,
        href: "/products",
      });
    }
  }
  const session = await getOpenSession(businessId);
  if (session) {
    const hours = (Date.now() - session.openedAt.getTime()) / 3600_000;
    if (hours > 12) {
      alerts.push({
        id: "session-old",
        type: "session",
        severity: "warn",
        title: "الخزنة مفتوحة من فترة طويلة",
        body: "يفضل عمل إقفال اليوم وعدّ الفلوس الفعلية.",
        href: "/cash",
      });
    }
  }
  const yesterday = dayBounds(new Date(Date.now() - 86400_000));
  const lastClosed = await getLastClosedSession(businessId);
  if (lastClosed && lastClosed.variance && Math.abs(toQ(lastClosed.variance)) > 0) {
    alerts.push({
      id: "variance-last",
      type: "variance",
      severity: "warn",
      title: `آخر إقفال فيه فرق خزنة ${fmtMoney(lastClosed.variance)}`,
      body: lastClosed.closeNote ?? undefined,
      href: "/cash",
    });
  }
  const balances = await getCustomerBalances(businessId);
  const debtors = (await db.select().from(customers).where(eq(customers.businessId, businessId))).filter(
    (c) => (balances[c.id] ?? 0) > 0,
  );
  if (debtors.length > 0) {
    const total = debtors.reduce((s, c) => s + (balances[c.id] ?? 0), 0);
    alerts.push({
      id: "debtors",
      type: "debt",
      severity: "info",
      title: `لك ${fmtMoney(total)} عند ${debtors.length} من العملاء`,
      body: debtors
        .slice(0, 3)
        .map((d) => `${d.name} (${fmtMoney(balances[d.id] ?? 0)})`)
        .join("، "),
      href: "/customers",
    });
  }
  void yesterday;
  return alerts;
}

/* ------------------------------ المبيعات ------------------------------ */
export async function getSalesSummary(
  businessId: number,
  start: Date,
  end: Date,
): Promise<{ sales: number; count: number; cash: number; credit: number; returns: number; itemsQty: number }> {
  const cond = and(
    eq(sales.businessId, businessId),
    eq(sales.status, "completed"),
    gte(sales.createdAt, start),
    lt(sales.createdAt, end),
  );
  const [saleAgg] = await db
    .select({
      total: sql<number>`coalesce(sum(${sales.total}), 0)::float8`,
      count: sql<number>`count(*)::int`,
    })
    .from(sales)
    .where(cond);
  const [cashAgg] = await db
    .select({ cash: sql<number>`coalesce(sum(${sales.paid}), 0)::float8` })
    .from(sales)
    .where(and(cond, eq(sales.method, "cash")));
  const [creditAgg] = await db
    .select({
      credit: sql<number>`coalesce(sum(${sales.total} - ${sales.paid}), 0)::float8`,
    })
    .from(sales)
    .where(and(cond, sql`${sales.method} = 'credit'`));
  const [retAgg] = await db
    .select({ total: sql<number>`coalesce(sum(${returns.total}), 0)::float8` })
    .from(returns)
    .where(
      and(
        eq(returns.businessId, businessId),
        gte(returns.createdAt, start),
        lt(returns.createdAt, end),
      ),
    );
  const [qtyAgg] = await db
    .select({
      qty: sql<number>`coalesce(sum(${saleItems.qty}), 0)::float8`,
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .where(
      and(
        eq(sales.businessId, businessId),
        eq(sales.status, "completed"),
        gte(sales.createdAt, start),
        lt(sales.createdAt, end),
      ),
    );
  return {
    sales: (saleAgg?.total ?? 0) / 100,
    count: saleAgg?.count ?? 0,
    cash: (cashAgg?.cash ?? 0) / 100,
    credit: (creditAgg?.credit ?? 0) / 100,
    returns: (retAgg?.total ?? 0) / 100,
    itemsQty: qtyAgg?.qty ?? 0,
  };
}

export async function getTopProducts(
  businessId: number,
  start: Date,
  end: Date,
): Promise<{ name: string; qty: number; revenue: number; profit: number }[]> {
  const rows = await db
    .select({
      name: saleItems.productName,
      qty: sql<number>`coalesce(sum(${saleItems.qty}), 0)::float8`,
      revenue: sql<number>`coalesce(sum(${saleItems.total}), 0)::float8`,
      profit: sql<number>`coalesce(sum(${saleItems.total} - coalesce(${saleItems.unitCost}, 0) * ${saleItems.qty}), 0)::float8`,
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .where(
      and(
        eq(sales.businessId, businessId),
        eq(sales.status, "completed"),
        gte(sales.createdAt, start),
        lt(sales.createdAt, end),
      ),
    )
    .groupBy(saleItems.productName)
    .orderBy(desc(sql`sum(${saleItems.total})`))
    .limit(8);
  return rows.map((r) => ({
    name: r.name,
    qty: r.qty,
    revenue: r.revenue / 100,
    profit: r.profit / 100,
  }));
}

/* ------------------------------ اللوحة الرئيسية ------------------------------ */
export async function getDashboard(businessId: number) {
  const { start, end } = dayBounds();
  const yesterday = dayBounds(new Date(Date.now() - 86400_000));
  const weekAgo = new Date(start.getTime() - 6 * 86400_000);

  const today = await getSalesSummary(businessId, start, end);
  const yest = await getSalesSummary(businessId, yesterday.start, yesterday.end);
  const week = await getSalesSummary(businessId, weekAgo, end);

  const [purchToday] = await db
    .select({ total: sql<number>`coalesce(sum(${purchases.total}), 0)::float8` })
    .from(purchases)
    .where(
      and(eq(purchases.businessId, businessId), gte(purchases.createdAt, start), lt(purchases.createdAt, end)),
    );
  const [expToday] = await db
    .select({ total: sql<number>`coalesce(sum(${expenses.amount}), 0)::float8` })
    .from(expenses)
    .where(
      and(eq(expenses.businessId, businessId), gte(expenses.createdAt, start), lt(expenses.createdAt, end)),
    );
  const [collToday] = await db
    .select({ total: sql<number>`coalesce(sum(${customerLedger.amount}), 0)::float8` })
    .from(customerLedger)
    .where(
      and(
        eq(customerLedger.businessId, businessId),
        eq(customerLedger.kind, "payment"),
        gte(customerLedger.createdAt, start),
        lt(customerLedger.createdAt, end),
      ),
    );
  const [payToday] = await db
    .select({ total: sql<number>`coalesce(sum(${supplierLedger.amount}), 0)::float8` })
    .from(supplierLedger)
    .where(
      and(
        eq(supplierLedger.businessId, businessId),
        eq(supplierLedger.kind, "payment"),
        gte(supplierLedger.createdAt, start),
        lt(supplierLedger.createdAt, end),
      ),
    );

  const cBal = await getCustomerBalances(businessId);
  const receivables = Object.values(cBal).reduce((s, v) => s + (v > 0 ? v : 0), 0) / 100;
  const sBal = await getSupplierBalances(businessId);
  const payables = Object.values(sBal).reduce((s, v) => s + (v > 0 ? v : 0), 0) / 100;

  const stock = await getStockMap(businessId);
  const lowStock = (
    await db.select().from(products).where(and(eq(products.businessId, businessId), eq(products.archived, false)))
  ).filter((p) => {
    const q = stock[p.id] ?? 0;
    const rp = Number(p.reorderPoint) || 0;
    return q < 0 || (rp > 0 && q <= rp);
  });

  // الربح التقديري: إجمالي الأصناف - تكلفتها - المصروفات
  const [grossAgg] = await db
    .select({
      revenue: sql<number>`coalesce(sum(${saleItems.total}), 0)::float8`,
      cost: sql<number>`coalesce(sum(coalesce(${saleItems.unitCost}, 0) * ${saleItems.qty}), 0)::float8`,
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .where(
      and(
        eq(sales.businessId, businessId),
        eq(sales.status, "completed"),
        gte(sales.createdAt, start),
        lt(sales.createdAt, end),
      ),
    );
  const gross = (grossAgg?.revenue ?? 0) / 100 - (grossAgg?.cost ?? 0) / 100;
  const net = gross - (expToday?.total ?? 0) / 100;

  const timeline = await db
    .select()
    .from(activityLog)
    .where(
      and(eq(activityLog.businessId, businessId), gte(activityLog.createdAt, start), lt(activityLog.createdAt, end)),
    )
    .orderBy(desc(activityLog.id))
    .limit(12);

  const session = await getOpenSession(businessId);
  const alerts = await getAlerts(businessId);
  const topProducts = await getTopProducts(businessId, start, end);
  const hour = cairoHour();

  return {
    hour,
    dateStr: fmtDateShort(new Date()),
    session,
    stats: {
      todaySales: today.sales,
      todaySalesCount: today.count,
      todayCash: today.cash,
      todayCredit: today.credit,
      todayReturns: today.returns,
      todayPurchases: (purchToday?.total ?? 0) / 100,
      todayExpenses: (expToday?.total ?? 0) / 100,
      todayCollections: -(collToday?.total ?? 0) / 100,
      todaySupplierPayments: -(payToday?.total ?? 0) / 100,
      receivables,
      payables,
      gross,
      net,
      yesterdaySales: yest.sales,
      weekAvgDaily: week.sales / 7,
    },
    lowStock: lowStock.slice(0, 6).map((p) => ({
      id: p.id,
      name: p.name,
      qty: stock[p.id] ?? 0,
      reorder: Number(p.reorderPoint) || 0,
    })),
    timeline: timeline.map((t) => ({
      id: t.id,
      action: t.action,
      summary: t.summary,
      actorName: t.actorName,
      at: t.createdAt,
    })),
    alerts: alerts.slice(0, 4),
    topProducts,
  };
}

/* ------------------------------ الصفحات ------------------------------ */
export async function getPosData(businessId: number) {
  const prods = await db
    .select({
      id: products.id,
      name: products.name,
      salePrice: products.salePrice,
      isWeighted: products.isWeighted,
      barcode: products.barcode,
      categoryId: products.categoryId,
      unitId: products.unitId,
      parentId: products.parentId,
      archived: products.archived,
    })
    .from(products)
    .where(and(eq(products.businessId, businessId), eq(products.archived, false)));
  const cats = await db
    .select()
    .from(categories)
    .where(eq(categories.businessId, businessId))
    .orderBy(asc(categories.sort));
  const custs = await db.select().from(customers).where(eq(customers.businessId, businessId));
  const balances = await getCustomerBalances(businessId);
  const stock = await getStockMap(businessId);
  const parents = new Map<number, string>();
  for (const p of prods) {
    if (p.parentId) {
      const parent = prods.find((x) => x.id === p.parentId);
      if (parent) parents.set(p.id, parent.name);
    }
  }
  return {
    products: prods.map((p) => ({
      id: p.id,
      name: p.name,
      parentName: parents.get(p.id),
      price: Number(p.salePrice) || 0,
      isWeighted: p.isWeighted,
      barcode: p.barcode ?? null,
      categoryId: p.categoryId ?? null,
      unitId: p.unitId,
      stock: stock[p.id] ?? 0,
    })),
    categories: cats.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji })),
    customers: custs.map((c) => ({
      id: c.id,
      name: c.name,
      balance: (balances[c.id] ?? 0) / 100,
      creditLimit: Number(c.creditLimit) || 0,
    })),
  };
}

export async function getProductsPage(businessId: number) {
  const prods = await db
    .select()
    .from(products)
    .where(and(eq(products.businessId, businessId), eq(products.archived, false)))
    .orderBy(asc(products.name));
  const cats = await db
    .select()
    .from(categories)
    .where(eq(categories.businessId, businessId))
    .orderBy(asc(categories.sort));
  const unitRows = await db.select().from(units).where(eq(units.businessId, businessId));
  const stock = await getStockMap(businessId);
  const catNames = new Map(cats.map((c) => [c.id, c.name]));
  const unitNames = new Map(unitRows.map((u) => [u.id, u.symbol]));
  return {
    products: prods.map((p) => ({
      id: p.id,
      name: p.name,
      categoryId: p.categoryId ?? null,
      categoryName: p.categoryId ? catNames.get(p.categoryId) ?? "" : "",
      unitId: p.unitId,
      unitSymbol: unitNames.get(p.unitId) ?? "",
      salePrice: Number(p.salePrice) || 0,
      costPrice: Number(p.costPrice) || 0,
      barcode: p.barcode ?? null,
      isWeighted: p.isWeighted,
      reorderPoint: Number(p.reorderPoint) || 0,
      stock: stock[p.id] ?? 0,
      parentId: p.parentId ?? null,
    })),
    categories: cats.map((c) => ({ id: c.id, name: c.name })),
    units: unitRows.map((u) => ({ id: u.id, name: u.name, symbol: u.symbol })),
  };
}

export async function getCustomersPage(businessId: number) {
  const custs = await db
    .select()
    .from(customers)
    .where(eq(customers.businessId, businessId))
    .orderBy(asc(customers.name));
  const balances = await getCustomerBalances(businessId);
  return custs.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone ?? "",
    creditLimit: Number(c.creditLimit) || 0,
    balance: (balances[c.id] ?? 0) / 100,
  }));
}

export async function getCustomerDetail(businessId: number, customerId: number) {
  const cust = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.businessId, businessId)))
    .limit(1);
  if (!cust[0]) return null;
  const ledger = await db
    .select()
    .from(customerLedger)
    .where(and(eq(customerLedger.businessId, businessId), eq(customerLedger.customerId, customerId)))
    .orderBy(desc(customerLedger.id))
    .limit(100);
  const saleRows = await db
    .select()
    .from(sales)
    .where(and(eq(sales.businessId, businessId), eq(sales.customerId, customerId)))
    .orderBy(desc(sales.id))
    .limit(100);
  const balance = ledger.reduce((s, l) => s + toQ(l.amount), 0) / 100;
  return {
    customer: { ...cust[0], balance },
    ledger: ledger.map((l) => ({
      id: l.id,
      amount: Number(l.amount),
      kind: l.kind,
      note: l.note,
      refId: l.refId,
      at: l.createdAt,
    })),
    sales: saleRows.map((s) => ({
      id: s.id,
      number: s.number,
      total: Number(s.total),
      paid: Number(s.paid),
      method: s.method,
      status: s.status,
      at: s.createdAt,
    })),
  };
}

export async function getSuppliersPage(businessId: number) {
  const sups = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.businessId, businessId))
    .orderBy(asc(suppliers.name));
  const balances = await getSupplierBalances(businessId);
  return sups.map((s) => ({
    id: s.id,
    name: s.name,
    phone: s.phone ?? "",
    balance: (balances[s.id] ?? 0) / 100,
  }));
}

export async function getSupplierDetail(businessId: number, supplierId: number) {
  const sup = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.businessId, businessId)))
    .limit(1);
  if (!sup[0]) return null;
  const ledger = await db
    .select()
    .from(supplierLedger)
    .where(and(eq(supplierLedger.businessId, businessId), eq(supplierLedger.supplierId, supplierId)))
    .orderBy(desc(supplierLedger.id))
    .limit(100);
  const purchRows = await db
    .select()
    .from(purchases)
    .where(and(eq(purchases.businessId, businessId), eq(purchases.supplierId, supplierId)))
    .orderBy(desc(purchases.id))
    .limit(100);
  const balance = ledger.reduce((s, l) => s + toQ(l.amount), 0) / 100;
  return {
    supplier: { ...sup[0], balance },
    ledger: ledger.map((l) => ({
      id: l.id,
      amount: Number(l.amount),
      kind: l.kind,
      note: l.note,
      refId: l.refId,
      at: l.createdAt,
    })),
    purchases: purchRows.map((p) => ({
      id: p.id,
      number: p.number,
      total: Number(p.total),
      paid: Number(p.paid),
      at: p.createdAt,
    })),
  };
}

export async function getSalesPage(businessId: number, limit = 100) {
  const rows = await db
    .select({
      id: sales.id,
      number: sales.number,
      kind: sales.kind,
      status: sales.status,
      total: sales.total,
      discount: sales.discount,
      paid: sales.paid,
      method: sales.method,
      note: sales.note,
      createdAt: sales.createdAt,
      createdBy: sales.createdBy,
      actorName: users.name,
      customerId: sales.customerId,
      customerName: customers.name,
    })
    .from(sales)
    .leftJoin(users, eq(users.id, sales.createdBy))
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .where(eq(sales.businessId, businessId))
    .orderBy(desc(sales.id))
    .limit(limit);

  const saleIds = rows.map((r) => r.id);
  const items = saleIds.length
    ? await db.select().from(saleItems).where(inArray(saleItems.saleId, saleIds))
    : [];
  const rets = saleIds.length
    ? await db.select().from(returns).where(inArray(returns.saleId, saleIds))
    : [];

  return rows.map((r) => {
    const myItems = items.filter((i) => i.saleId === r.id);
    const returned = rets
      .filter((x) => x.saleId === r.id)
      .reduce((s, x) => s + toQ(x.total), 0) / 100;
    return {
      id: r.id,
      number: r.number,
      kind: r.kind,
      status: r.status,
      total: Number(r.total),
      discount: Number(r.discount),
      paid: Number(r.paid),
      method: r.method,
      note: r.note,
      returned,
      at: r.createdAt,
      actorName: r.actorName,
      customerId: r.customerId ?? null,
      customerName: r.customerName ?? null,
      items: myItems.map((i) => ({
        id: i.id,
        productId: i.productId ?? null,
        name: i.productName,
        qty: Number(i.qty),
        unitPrice: Number(i.unitPrice),
        total: Number(i.total),
      })),
    };
  });
}

export async function getPurchasesPage(businessId: number) {
  const rows = await db
    .select({
      id: purchases.id,
      number: purchases.number,
      total: purchases.total,
      paid: purchases.paid,
      note: purchases.note,
      createdAt: purchases.createdAt,
      supplierId: purchases.supplierId,
      supplierName: suppliers.name,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .where(eq(purchases.businessId, businessId))
    .orderBy(desc(purchases.id))
    .limit(100);
  const ids = rows.map((r) => r.id);
  const items = ids.length
    ? await db.select().from(purchaseItems).where(inArray(purchaseItems.purchaseId, ids))
    : [];
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    total: Number(r.total),
    paid: Number(r.paid),
    note: r.note,
    at: r.createdAt,
    supplierId: r.supplierId ?? null,
    supplierName: r.supplierName ?? null,
    items: items
      .filter((i) => i.purchaseId === r.id)
      .map((i) => ({ id: i.id, name: i.productName, qty: Number(i.qty), unitCost: Number(i.unitCost), total: Number(i.total) })),
  }));
}

export async function getExpensesPage(businessId: number) {
  const { start, end } = dayBounds();
  const rows = await db
    .select()
    .from(expenses)
    .where(eq(expenses.businessId, businessId))
    .orderBy(desc(expenses.id))
    .limit(150);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let monthTotal = 0;
  for (const r of rows) {
    if (r.createdAt >= monthStart) monthTotal += toQ(r.amount);
  }
  return {
    monthTotal: monthTotal / 100,
    expenses: rows.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      category: r.category,
      note: r.note,
      at: r.createdAt,
      isToday: r.createdAt >= start && r.createdAt < end,
    })),
  };
}

export async function getCashPage(businessId: number) {
  const session = await getOpenSession(businessId);
  const lastClosed = await getLastClosedSession(businessId);
  let movs: typeof cashMovements.$inferSelect[] = [];
  if (session) {
    movs = await db
      .select()
      .from(cashMovements)
      .where(eq(cashMovements.sessionId, session.id))
      .orderBy(desc(cashMovements.id))
      .limit(100);
  }
  const byType: Record<string, number> = {};
  let expected = 0;
  for (const m of movs) {
    const q = toQ(m.amount);
    expected += q;
    byType[m.type] = (byType[m.type] ?? 0) + q;
  }
  return {
    session,
    lastClosed: lastClosed
      ? {
          id: lastClosed.id,
          opening: Number(lastClosed.opening),
          expected: Number(lastClosed.expected),
          actual: Number(lastClosed.actual),
          variance: Number(lastClosed.variance),
          closeNote: lastClosed.closeNote,
          closedAt: lastClosed.closedAt,
        }
      : null,
    expected: expected / 100,
    breakdown: Object.entries(byType)
      .map(([type, q]) => ({
        type,
        label: CASH_TYPE_LABELS[type] ?? type,
        amount: q / 100,
      }))
      .sort((a, b) => b.amount - a.amount),
    movements: movs.map((m) => ({
      id: m.id,
      type: m.type,
      label: CASH_TYPE_LABELS[m.type] ?? m.type,
      amount: Number(m.amount),
      note: m.note,
      at: m.createdAt,
    })),
  };
}

export async function getReportsPage(businessId: number, days: number) {
  const end = new Date();
  const start = new Date(Date.now() - days * 86400_000);
  const summary = await getSalesSummary(businessId, start, end);
  const prevStart = new Date(start.getTime() - days * 86400_000);
  const prev = await getSalesSummary(businessId, prevStart, start);

  const [purch] = await db
    .select({ total: sql<number>`coalesce(sum(${purchases.total}), 0)::float8`, count: sql<number>`count(*)::int` })
    .from(purchases)
    .where(and(eq(purchases.businessId, businessId), gte(purchases.createdAt, start), lt(purchases.createdAt, end)));
  const [paidPurch] = await db
    .select({ total: sql<number>`coalesce(sum(${purchases.paid}), 0)::float8` })
    .from(purchases)
    .where(and(eq(purchases.businessId, businessId), gte(purchases.createdAt, start), lt(purchases.createdAt, end)));
  const expRows = await db
    .select({
      category: expenses.category,
      total: sql<number>`coalesce(sum(${expenses.amount}), 0)::float8`,
    })
    .from(expenses)
    .where(and(eq(expenses.businessId, businessId), gte(expenses.createdAt, start), lt(expenses.createdAt, end)))
    .groupBy(expenses.category)
    .orderBy(desc(sql`sum(${expenses.amount})`));
  const [coll] = await db
    .select({ total: sql<number>`coalesce(sum(${customerLedger.amount}), 0)::float8` })
    .from(customerLedger)
    .where(
      and(
        eq(customerLedger.businessId, businessId),
        eq(customerLedger.kind, "payment"),
        gte(customerLedger.createdAt, start),
        lt(customerLedger.createdAt, end),
      ),
    );
  const [supPay] = await db
    .select({ total: sql<number>`coalesce(sum(${supplierLedger.amount}), 0)::float8` })
    .from(supplierLedger)
    .where(
      and(
        eq(supplierLedger.businessId, businessId),
        eq(supplierLedger.kind, "payment"),
        gte(supplierLedger.createdAt, start),
        lt(supplierLedger.createdAt, end),
      ),
    );

  const [grossAgg] = await db
    .select({
      revenue: sql<number>`coalesce(sum(${saleItems.total}), 0)::float8`,
      cost: sql<number>`coalesce(sum(coalesce(${saleItems.unitCost}, 0) * ${saleItems.qty}), 0)::float8`,
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .where(
      and(
        eq(sales.businessId, businessId),
        eq(sales.status, "completed"),
        gte(sales.createdAt, start),
        lt(sales.createdAt, end),
      ),
    );

  const totalExpenses = expRows.reduce((s, r) => s + r.total, 0) / 100;
  const gross = (grossAgg?.revenue ?? 0) / 100 - (grossAgg?.cost ?? 0) / 100;
  const topProducts = await getTopProducts(businessId, start, end);
  const stock = await getStockMap(businessId);
  const prods = await db
    .select()
    .from(products)
    .where(and(eq(products.businessId, businessId), eq(products.archived, false)));
  const stockValue = prods.reduce(
    (s, p) => s + (Number(p.costPrice) || 0) * (stock[p.id] ?? 0),
    0,
  );
  const deadStock = prods.filter((p) => (stock[p.id] ?? 0) > 0 && !topProducts.some((t) => t.name === p.name)).slice(0, 5);

  return {
    days,
    summary,
    prev,
    purchases: { total: (purch?.total ?? 0) / 100, count: purch?.count ?? 0, paid: (paidPurch?.total ?? 0) / 100 },
    expensesByCategory: expRows.map((r) => ({ category: r.category, total: r.total / 100 })),
    totalExpenses,
    collections: -(coll?.total ?? 0) / 100,
    supplierPayments: -(supPay?.total ?? 0) / 100,
    gross,
    net: gross - totalExpenses,
    topProducts,
    stockValue,
    deadStock: deadStock.map((p) => ({ id: p.id, name: p.name, qty: stock[p.id] ?? 0 })),
  };
}

export async function getTimelinePage(businessId: number, limit = 150) {
  const rows = await db
    .select()
    .from(activityLog)
    .where(eq(activityLog.businessId, businessId))
    .orderBy(desc(activityLog.id))
    .limit(limit);
  return rows.map((t) => ({
    id: t.id,
    action: t.action,
    summary: t.summary,
    actorName: t.actorName,
    at: t.createdAt,
  }));
}

export async function getEmployeesPage(businessId: number) {
  const rows = await db
    .select({
      id: usersBusinesses.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      role: usersBusinesses.role,
      joinedAt: usersBusinesses.createdAt,
    })
    .from(usersBusinesses)
    .innerJoin(users, eq(users.id, usersBusinesses.userId))
    .where(eq(usersBusinesses.businessId, businessId))
    .orderBy(asc(users.name));
  return rows;
}

export async function getBusinessList(businessId: number) {
  const b = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  return b[0] ?? null;
}

/* ------------------------------ المساعد ------------------------------ */
export async function assistantContext(businessId: number) {
  const { start, end } = dayBounds();
  const yesterday = dayBounds(new Date(Date.now() - 86400_000));
  const weekStart = new Date(start.getTime() - 6 * 86400_000);
  const today = await getSalesSummary(businessId, start, end);
  const yest = await getSalesSummary(businessId, yesterday.start, yesterday.end);
  const week = await getSalesSummary(businessId, weekStart, end);
  const prevWeek = await getSalesSummary(businessId, new Date(weekStart.getTime() - 7 * 86400_000), weekStart);
  const session = await getOpenSession(businessId);
  const debtors = (await getAllCustomers(businessId)).filter((c) => c.balance > 0);
  const supDebts = (await getAllSuppliers(businessId)).filter((s) => s.balance > 0);
  const topProducts = await getTopProducts(businessId, start, end);
  const low = await getLowStock(businessId);
  const alerts = await getAlerts(businessId);
  return { today, yest, week, prevWeek, session, debtors, supDebts, topProducts, low, alerts };
}

export async function getLowStock(businessId: number) {
  const stock = await getStockMap(businessId);
  const prods = await db
    .select()
    .from(products)
    .where(and(eq(products.businessId, businessId), eq(products.archived, false)));
  return prods
    .map((p) => ({ id: p.id, name: p.name, qty: stock[p.id] ?? 0, reorder: Number(p.reorderPoint) || 0 }))
    .filter((p) => p.qty < 0 || (p.reorder > 0 && p.qty <= p.reorder))
    .sort((a, b) => a.qty - b.qty);
}

export async function getAllProducts(businessId: number) {
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.businessId, businessId), eq(products.archived, false)))
    .orderBy(asc(products.name));
  const stock = await getStockMap(businessId);
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    salePrice: Number(p.salePrice) || 0,
    costPrice: Number(p.costPrice) || 0,
    isWeighted: p.isWeighted,
    stock: stock[p.id] ?? 0,
  }));
}

export async function getAllCustomers(businessId: number) {
  const rows = await db
    .select()
    .from(customers)
    .where(eq(customers.businessId, businessId))
    .orderBy(asc(customers.name));
  const balances = await getCustomerBalances(businessId);
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    balance: (balances[c.id] ?? 0) / 100,
  }));
}

export async function getAllSuppliers(businessId: number) {
  const rows = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.businessId, businessId))
    .orderBy(asc(suppliers.name));
  const balances = await getSupplierBalances(businessId);
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    balance: (balances[s.id] ?? 0) / 100,
  }));
}

export async function ensureSeeded() {
  const { seedIfEmpty } = await import("@/db/seed");
  return seedIfEmpty();
}
