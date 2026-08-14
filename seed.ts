import { scryptSync, randomBytes } from "node:crypto";
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
import { n, nq } from "@/lib/money";

const hash = (password: string): string => {
  const salt = randomBytes(8).toString("hex");
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
};

const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600_000);

let seq = 0;
async function act(
  businessId: number,
  actorId: number,
  actorName: string,
  action: string,
  summary: string,
  hoursAgo: number,
) {
  seq += 1;
  await db.insert(activityLog).values({
    businessId,
    actorId,
    actorName,
    action,
    summary,
    createdAt: at(hoursAgo),
  });
}

type Biz = { id: number; unitPiece: number; unitKg: number; unitGram: number; unitLiter: number; unitCarton: number; catIds: Map<string, number> };

async function createCatalog(
  biz: Biz,
  catList: { name: string; emoji: string }[],
): Promise<void> {
  for (const [i, c] of catList.entries()) {
    const [row] = await db
      .insert(categories)
      .values({ businessId: biz.id, name: c.name, emoji: c.emoji, sort: i })
      .returning();
    biz.catIds.set(c.name, row.id);
  }
}

async function addProduct(
  biz: Biz,
  opts: {
    name: string;
    cat: string;
    sale: number; // قروش
    cost: number | null;
    unit: "piece" | "kg" | "gram" | "liter" | "carton";
    stock: number;
    reorder?: number;
    barcode?: string;
    weighted?: boolean;
    parentId?: number;
    archived?: boolean;
  },
): Promise<number> {
  const unitId =
    opts.unit === "kg"
      ? biz.unitKg
      : opts.unit === "gram"
        ? biz.unitGram
        : opts.unit === "liter"
          ? biz.unitLiter
          : opts.unit === "carton"
            ? biz.unitCarton
            : biz.unitPiece;
  const [p] = await db
    .insert(products)
    .values({
      businessId: biz.id,
      name: opts.name,
      categoryId: biz.catIds.get(opts.cat) ?? null,
      unitId,
      salePrice: n(opts.sale),
      costPrice: opts.cost !== null ? n(opts.cost) : null,
      barcode: opts.barcode ?? null,
      isWeighted: opts.weighted ?? false,
      reorderPoint: nq(opts.reorder ?? 0),
      parentId: opts.parentId ?? null,
      archived: opts.archived ?? false,
    })
    .returning();
  if (opts.stock > 0) {
    await db.insert(stockMovements).values({
      businessId: biz.id,
      productId: p.id,
      delta: nq(opts.stock),
      reason: "opening",
      note: "رصيد افتتاحي",
      createdAt: at(72),
    });
  }
  return p.id;
}

async function sale(
  biz: Biz,
  opts: {
    num: number;
    hoursAgo: number;
    kind?: "detailed" | "quick";
    method: "cash" | "card" | "wallet" | "credit";
    items?: { pid: number; qty: number; price: number; cost: number | null; weighted?: boolean }[];
    quickTotal?: number;
    customerId?: number;
    sessionId: number;
    actorId: number;
    discount?: number;
  },
): Promise<void> {
  const isQuick = opts.kind === "quick";
  // الأسعار هنا بالقرش، والإجمالي بالقرش أيضًا
  const itemsTotal = isQuick
    ? opts.quickTotal!
    : (opts.items ?? []).reduce((s, i) => s + Math.round(i.qty * i.price), 0);
  const total = itemsTotal - (opts.discount ?? 0);
  const paid = opts.method === "credit" ? 0 : total;
  const [s] = await db
    .insert(sales)
    .values({
      businessId: biz.id,
      number: opts.num,
      kind: opts.kind ?? "detailed",
      customerId: opts.customerId ?? null,
      status: "completed",
      total: n(total),
      discount: n(opts.discount ?? 0),
      paid: n(paid),
      method: opts.method,
      createdAt: at(opts.hoursAgo),
      createdBy: opts.actorId,
    })
    .returning();

  if (isQuick) {
    await db.insert(saleItems).values({
      saleId: s.id,
      productId: null,
      productName: "بيع سريع (بدون أصناف)",
      qty: nq(1),
      unitPrice: n(total),
      unitCost: null,
      total: n(total),
      isWeighted: false,
    });
  } else {
    for (const it of opts.items ?? []) {
      const lineTotal = Math.round(it.qty * it.price);
      await db.insert(saleItems).values({
        saleId: s.id,
        productId: it.pid,
        productName: (await db.select({ name: products.name }).from(products).where(eq(products.id, it.pid)).limit(1))[0]?.name ?? "صنف",
        qty: nq(it.qty),
        unitPrice: n(it.price),
        unitCost: it.cost !== null ? n(it.cost) : null,
        total: n(lineTotal),
        isWeighted: it.weighted ?? false,
      });
      await db.insert(stockMovements).values({
        businessId: biz.id,
        productId: it.pid,
        delta: nq(-it.qty),
        reason: "sale",
        refId: s.id,
        refType: "sale",
        note: `بيع — فاتورة رقم ${opts.num}`,
        createdAt: at(opts.hoursAgo),
        createdBy: opts.actorId,
      });
    }
  }

  if (paid > 0) {
    await db.insert(payments).values({
      businessId: biz.id,
      saleId: s.id,
      amount: n(paid),
      method: opts.method === "credit" ? "cash" : opts.method,
      createdAt: at(opts.hoursAgo),
      createdBy: opts.actorId,
    });
  }
  if (opts.method === "cash" && paid > 0) {
    await db.insert(cashMovements).values({
      businessId: biz.id,
      sessionId: opts.sessionId,
      type: "cash_sale",
      amount: n(paid),
      note: `فاتورة رقم ${opts.num}`,
      refId: s.id,
      refType: "sale",
      createdAt: at(opts.hoursAgo),
      createdBy: opts.actorId,
    });
  }
  if (opts.method === "credit" && opts.customerId) {
    await db.insert(customerLedger).values({
      businessId: biz.id,
      customerId: opts.customerId,
      amount: n(total),
      kind: "sale",
      refId: s.id,
      refType: "sale",
      note: `فاتورة رقم ${opts.num}`,
      createdAt: at(opts.hoursAgo),
      createdBy: opts.actorId,
    });
  }
}

import { eq } from "drizzle-orm";

export async function seedIfEmpty(): Promise<boolean> {
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) return false;

  /* ------------------------------ المستخدمون ------------------------------ */
  const [ahmed] = await db
    .insert(users)
    .values([
      { name: "أحمد شاكر", email: "ahmed@demo.com", passwordHash: hash("1234") },
      { name: "سارة كمال", email: "sara@demo.com", passwordHash: hash("1234") },
      { name: "محمود فتحي", email: "mahmoud@demo.com", passwordHash: hash("1234") },
    ])
    .returning();

  /* ------------------------------ الأنشطة ------------------------------ */
  const [superBiz] = await db
    .insert(businesses)
    .values({
      name: "سوبر ماركت النور",
      type: "supermarket",
      hasEmployees: true,
      sellsOnCredit: true,
      manageInventory: true,
      usesBarcode: true,
    })
    .returning();
  const [attaraBiz] = await db
    .insert(businesses)
    .values({
      name: "عطارة الحاج شاكر",
      type: "attara",
      hasEmployees: false,
      sellsOnCredit: true,
      manageInventory: true,
      usesBarcode: false,
    })
    .returning();
  const [generalBiz] = await db
    .insert(businesses)
    .values({
      name: "محل الأمانة",
      type: "general",
      hasEmployees: true,
      sellsOnCredit: true,
      manageInventory: true,
      usesBarcode: false,
    })
    .returning();

  await db.insert(usersBusinesses).values([
    { userId: ahmed.id, businessId: superBiz.id, role: "owner" },
    { userId: ahmed.id, businessId: attaraBiz.id, role: "owner" },
    { userId: ahmed.id, businessId: generalBiz.id, role: "owner" },
  ]);
  const [sara] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, "sara@demo.com"))
    .limit(1);
  const [mahmoud] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, "mahmoud@demo.com"))
    .limit(1);
  await db.insert(usersBusinesses).values([
    { userId: sara.id, businessId: superBiz.id, role: "cashier" },
    { userId: sara.id, businessId: generalBiz.id, role: "cashier" },
    { userId: mahmoud.id, businessId: superBiz.id, role: "manager" },
  ]);

  async function makeBiz(businessId: number): Promise<Biz> {
    const unitRows = await db
      .insert(units)
      .values([
        { businessId, name: "قطعة", symbol: "قطعة", kind: "piece" as const },
        { businessId, name: "كيلو", symbol: "كجم", kind: "kg" as const },
        { businessId, name: "جرام", symbol: "جم", kind: "gram" as const },
        { businessId, name: "لتر", symbol: "لتر", kind: "liter" as const },
        { businessId, name: "كرتونة", symbol: "كرتونة", kind: "carton" as const },
      ])
      .returning();
    return {
      id: businessId,
      unitPiece: unitRows[0].id,
      unitKg: unitRows[1].id,
      unitGram: unitRows[2].id,
      unitLiter: unitRows[3].id,
      unitCarton: unitRows[4].id,
      catIds: new Map(),
    };
  }

  /* =========================== سوبر ماركت =========================== */
  {
    const biz = await makeBiz(superBiz.id);
    await createCatalog(biz, [
      { name: "مشروبات", emoji: "🥤" },
      { name: "ألبان", emoji: "🥛" },
      { name: "سناكس", emoji: "🍿" },
      { name: "بقالة", emoji: "🛒" },
      { name: "منظفات", emoji: "🧴" },
    ]);
    const pepsi = await addProduct(biz, { name: "بيبسي", cat: "مشروبات", sale: 1200, cost: 950, unit: "piece", stock: 30, reorder: 20, barcode: "6223000000011" });
    const pepsiDiet = await addProduct(biz, { name: "بيبسي دايت", cat: "مشروبات", sale: 1400, cost: 1100, unit: "piece", stock: 10, reorder: 10, barcode: "6223000000028" });
    const water = await addProduct(biz, { name: "مياه معدنية", cat: "مشروبات", sale: 600, cost: 400, unit: "piece", stock: 30, reorder: 40, barcode: "6223000000035" });
    const chips = await addProduct(biz, { name: "شيبسي", cat: "سناكس", sale: 1000, cost: 750, unit: "piece", stock: 20, reorder: 15, barcode: "6223000000042" });
    const milk = await addProduct(biz, { name: "لبن كامل", cat: "ألبان", sale: 3200, cost: 2800, unit: "piece", stock: 12, reorder: 10, barcode: "6223000000059" });
    const rice = await addProduct(biz, { name: "أرز 5 كيلو", cat: "بقالة", sale: 19500, cost: 17500, unit: "piece", stock: 6, reorder: 5 });
    const sugar = await addProduct(biz, { name: "سكر 1 كيلو", cat: "بقالة", sale: 3800, cost: 3400, unit: "piece", stock: 8, reorder: 10 });
    const oil = await addProduct(biz, { name: "زيت عباد الشمس", cat: "بقالة", sale: 8500, cost: 7600, unit: "liter", stock: 5, reorder: 8 });
    const detergent = await addProduct(biz, { name: "مسحوق غسيل", cat: "منظفات", sale: 12000, cost: 10000, unit: "piece", stock: 4, reorder: 6 });

    const [mohamed] = await db
      .insert(customers)
      .values({ businessId: biz.id, name: "محمد عبد العاطي", phone: "01001112223", creditLimit: n(40000) })
      .returning();
    const [ahmedSayed] = await db
      .insert(customers)
      .values({ businessId: biz.id, name: "أحمد السيد", phone: "01114445556", creditLimit: n(20000) })
      .returning();
    const [khaled] = await db
      .insert(customers)
      .values({ businessId: biz.id, name: "خالد حسن", phone: "01227778889", creditLimit: n(10000) })
      .returning();
    void ahmedSayed;
    void khaled;

    const [jamil] = await db
      .insert(suppliers)
      .values({ businessId: biz.id, name: "شركة الجميل للبضاعة", phone: "01009998888" })
      .returning();
    const [halawa] = await db
      .insert(suppliers)
      .values({ businessId: biz.id, name: "مصنع الحلاوة", phone: "01118887777" })
      .returning();
    void halawa;

    /* جلسة أمس (مقفولة) */
    const [ySession] = await db
      .insert(cashSessions)
      .values({
        businessId: biz.id,
        opening: n(400000),
        status: "closed",
        openedAt: at(30),
        closedAt: at(23),
        expected: n(413400),
        actual: n(410000),
        variance: n(-3400),
        closeNote: "فرق خزنة صغير — محتمل نثريات",
        openedBy: ahmed.id,
        closedBy: ahmed.id,
      })
      .returning();
    await db.insert(cashMovements).values([
      { businessId: biz.id, sessionId: ySession.id, type: "opening", amount: n(400000), createdAt: at(30), createdBy: ahmed.id },
      { businessId: biz.id, sessionId: ySession.id, type: "expense", amount: n(-5000), note: "نقل — أجرة يومية", createdAt: at(25), createdBy: ahmed.id },
    ]);
    await sale(biz, { num: 1, hoursAgo: 28, method: "cash", sessionId: ySession.id, actorId: ahmed.id, items: [{ pid: pepsi, qty: 2, price: 1200, cost: 950 }, { pid: chips, qty: 1, price: 1000, cost: 750 }] });
    await sale(biz, { num: 2, hoursAgo: 27, kind: "quick", method: "cash", quickTotal: 15000, sessionId: ySession.id, actorId: ahmed.id });
    await sale(biz, { num: 3, hoursAgo: 26, method: "credit", sessionId: ySession.id, actorId: ahmed.id, customerId: mohamed.id, items: [{ pid: water, qty: 4, price: 600, cost: 400 }, { pid: rice, qty: 1, price: 19500, cost: 17500 }] });
    await db.insert(expenses).values({
      businessId: biz.id,
      amount: n(5000),
      category: "نقل",
      note: "أجرة يومية",
      createdAt: at(25),
      createdBy: ahmed.id,
    });

    /* جلسة اليوم (مفتوحة) */
    const [tSession] = await db
      .insert(cashSessions)
      .values({
        businessId: biz.id,
        opening: n(500000),
        note: "فتح المحل",
        status: "open",
        openedAt: at(4),
        openedBy: ahmed.id,
      })
      .returning();
    await db.insert(cashMovements).values([
      { businessId: biz.id, sessionId: tSession.id, type: "opening", amount: n(500000), createdAt: at(4), createdBy: ahmed.id },
      { businessId: biz.id, sessionId: tSession.id, type: "collection", amount: n(5000), note: "تحصيل من محمد عبد العاطي", createdAt: at(1.5), createdBy: ahmed.id },
      { businessId: biz.id, sessionId: tSession.id, type: "cash_purchase", amount: n(-5000), note: "شراء رقم 1", refId: 1, refType: "purchase", createdAt: at(1), createdBy: ahmed.id },
      { businessId: biz.id, sessionId: tSession.id, type: "expense", amount: n(-3000), note: "كهرباء — فاتورة الشهر", createdAt: at(0.8), createdBy: ahmed.id },
      { businessId: biz.id, sessionId: tSession.id, type: "expense", amount: n(-500), note: "نثريات — سلوفان", createdAt: at(0.5), createdBy: ahmed.id },
    ]);
    await sale(biz, { num: 4, hoursAgo: 3.5, method: "cash", sessionId: tSession.id, actorId: sara.id, items: [{ pid: milk, qty: 2, price: 3200, cost: 2800 }, { pid: chips, qty: 1, price: 1000, cost: 750 }] });
    await sale(biz, { num: 5, hoursAgo: 3, method: "card", sessionId: tSession.id, actorId: sara.id, items: [{ pid: pepsi, qty: 3, price: 1200, cost: 950 }, { pid: pepsiDiet, qty: 1, price: 1400, cost: 1100 }] });
    await sale(biz, { num: 6, hoursAgo: 2.5, method: "credit", sessionId: tSession.id, actorId: sara.id, customerId: mohamed.id, items: [{ pid: oil, qty: 1, price: 8500, cost: 7600 }, { pid: sugar, qty: 2, price: 3800, cost: 3400 }] });
    await sale(biz, { num: 7, hoursAgo: 2, kind: "quick", method: "cash", quickTotal: 15000, sessionId: tSession.id, actorId: sara.id });

    /* محمد دفع 50 ج */
    await db.insert(customerLedger).values({
      businessId: biz.id,
      customerId: mohamed.id,
      amount: n(-5000),
      kind: "payment",
      note: "دفعة من الحساب",
      createdAt: at(1.5),
      createdBy: ahmed.id,
    });
    await db.insert(payments).values({
      businessId: biz.id,
      amount: n(5000),
      method: "cash",
      note: "تحصيل من محمد عبد العاطي",
      createdAt: at(1.5),
      createdBy: ahmed.id,
    });

    /* شراء من شركة الجميل */
    const [purchase] = await db
      .insert(purchases)
      .values({
        businessId: biz.id,
        number: 1,
        supplierId: jamil.id,
        total: n(21000),
        paid: n(5000),
        note: "دفعة مقدم",
        createdAt: at(1),
        createdBy: ahmed.id,
      })
      .returning();
    await db.insert(purchaseItems).values([
      { purchaseId: purchase.id, productId: water, productName: "مياه معدنية", qty: nq(10), unitCost: n(400), total: n(4000) },
      { purchaseId: purchase.id, productId: pepsi, productName: "بيبسي", qty: nq(10), unitCost: n(950), total: n(9500) },
      { purchaseId: purchase.id, productId: chips, productName: "شيبسي", qty: nq(10), unitCost: n(750), total: n(7500) },
    ]);
    await db.insert(stockMovements).values([
      { businessId: biz.id, productId: water, delta: nq(10), reason: "purchase", refId: purchase.id, refType: "purchase", note: "شراء رقم 1", createdAt: at(1), createdBy: ahmed.id },
      { businessId: biz.id, productId: pepsi, delta: nq(10), reason: "purchase", refId: purchase.id, refType: "purchase", note: "شراء رقم 1", createdAt: at(1), createdBy: ahmed.id },
      { businessId: biz.id, productId: chips, delta: nq(10), reason: "purchase", refId: purchase.id, refType: "purchase", note: "شراء رقم 1", createdAt: at(1), createdBy: ahmed.id },
    ]);
    await db.insert(supplierLedger).values({
      businessId: biz.id,
      supplierId: jamil.id,
      amount: n(21000),
      kind: "purchase",
      refId: purchase.id,
      refType: "purchase",
      note: "شراء رقم 1",
      createdAt: at(1),
      createdBy: ahmed.id,
    });
    await db.insert(expenses).values([
      { businessId: biz.id, amount: n(3000), category: "كهرباء", note: "فاتورة الشهر", createdAt: at(0.8), createdBy: ahmed.id },
      { businessId: biz.id, amount: n(500), category: "نثريات", note: "سلوفان", createdAt: at(0.5), createdBy: ahmed.id },
    ]);

    await act(biz.id, ahmed.id, "أحمد شاكر", "cash_opened", "فتح الخزنة بمبلغ ٥٬٠٠٠ ج.م", 4);
    await act(biz.id, sara.id, "سارة كمال", "sale_created", "فاتورة رقم 4 — ٧٤ ج.م (مدفوع)", 3.5);
    await act(biz.id, sara.id, "سارة كمال", "sale_created", "فاتورة رقم 5 — ٥٠ ج.م (كارت)", 3);
    await act(biz.id, sara.id, "سارة كمال", "sale_created", "فاتورة رقم 6 — ١٦١ ج.م (آجل على محمد عبد العاطي)", 2.5);
    await act(biz.id, sara.id, "سارة كمال", "sale_created", "فاتورة رقم 7 — ١٥٠ ج.م (بيع سريع)", 2);
    await act(biz.id, ahmed.id, "أحمد شاكر", "customer_payment", "قبض ٥٠ ج.م من محمد عبد العاطي", 1.5);
    await act(biz.id, ahmed.id, "أحمد شاكر", "purchase_created", "شراء رقم 1 — ٢١٠ ج.م (مدفوع ٥٠ ج.م، آجل لدى المورد)", 1);
    await act(biz.id, ahmed.id, "أحمد شاكر", "expense_recorded", "مصروف كهرباء — ٣٠ ج.م", 0.8);
    await act(biz.id, ahmed.id, "أحمد شاكر", "expense_recorded", "مصروف نثريات — ٥ ج.م", 0.5);
    await act(biz.id, ahmed.id, "أحمد شاكر", "cash_closed", "إقفال يوم أمس — فرق خزنة -٣٤ ج.م", 23);
  }

  /* =========================== العطارة =========================== */
  {
    const biz = await makeBiz(attaraBiz.id);
    await createCatalog(biz, [
      { name: "بهارات", emoji: "🌿" },
      { name: "أعشاب", emoji: "🫖" },
      { name: "مكسرات", emoji: "🥜" },
    ]);
    const zaatar = await addProduct(biz, { name: "زعتر بلدي", cat: "بهارات", sale: 18000, cost: 13000, unit: "kg", stock: 5, reorder: 2, weighted: true });
    const pepper = await addProduct(biz, { name: "فلفل أسود", cat: "بهارات", sale: 34000, cost: 28000, unit: "kg", stock: 5, reorder: 2, weighted: true });
    const cumin = await addProduct(biz, { name: "كمون بلدي", cat: "بهارات", sale: 26000, cost: 21000, unit: "kg", stock: 5, reorder: 2, weighted: true });
    const turmeric = await addProduct(biz, { name: "كركم", cat: "بهارات", sale: 12000, cost: 9000, unit: "kg", stock: 4, reorder: 2, weighted: true });
    const hibiscus = await addProduct(biz, { name: "كركديه", cat: "أعشاب", sale: 14000, cost: 10000, unit: "kg", stock: 6, reorder: 2, weighted: true });
    const tea = await addProduct(biz, { name: "شاي سائب", cat: "أعشاب", sale: 16000, cost: 12000, unit: "kg", stock: 3, reorder: 2, weighted: true });
    const cinnamon = await addProduct(biz, { name: "قرفة أعواد", cat: "بهارات", sale: 22000, cost: 18000, unit: "kg", stock: 2, reorder: 1, weighted: true });
    const cloves = await addProduct(biz, { name: "قرنفل حب", cat: "بهارات", sale: 48000, cost: 40000, unit: "kg", stock: 2, reorder: 1, weighted: true });

    const [omHassan] = await db
      .insert(customers)
      .values({ businessId: biz.id, name: "أم حسن", phone: "01023334445" })
      .returning();
    const [roaster] = await db
      .insert(suppliers)
      .values({ businessId: biz.id, name: "محمصة السلام", phone: "01005556667" })
      .returning();

    const [session] = await db
      .insert(cashSessions)
      .values({ businessId: biz.id, opening: n(300000), status: "open", openedAt: at(2), openedBy: ahmed.id })
      .returning();
    await db.insert(cashMovements).values([
      { businessId: biz.id, sessionId: session.id, type: "opening", amount: n(300000), createdAt: at(2), createdBy: ahmed.id },
      { businessId: biz.id, sessionId: session.id, type: "cash_purchase", amount: n(-20000), note: "شراء رقم 1", refId: 1, refType: "purchase", createdAt: at(0.8), createdBy: ahmed.id },
    ]);
    await sale(biz, { num: 1, hoursAgo: 1.5, method: "cash", sessionId: session.id, actorId: ahmed.id, items: [{ pid: zaatar, qty: 0.75, price: 18000, cost: 13000, weighted: true }] });
    await sale(biz, { num: 2, hoursAgo: 1, method: "cash", sessionId: session.id, actorId: ahmed.id, items: [{ pid: cumin, qty: 0.5, price: 26000, cost: 21000, weighted: true }] });
    await sale(biz, { num: 3, hoursAgo: 0.7, method: "credit", sessionId: session.id, actorId: ahmed.id, customerId: omHassan.id, items: [{ pid: pepper, qty: 0.25, price: 34000, cost: 28000, weighted: true }] });

    const [purchase] = await db
      .insert(purchases)
      .values({
        businessId: biz.id,
        number: 1,
        supplierId: roaster.id,
        total: n(56000),
        paid: n(20000),
        note: "دفعة مقدم",
        createdAt: at(0.8),
        createdBy: ahmed.id,
      })
      .returning();
    await db.insert(purchaseItems).values([
      { purchaseId: purchase.id, productId: pepper, productName: "فلفل أسود", qty: nq(2), unitCost: n(28000), total: n(56000) },
    ]);
    await db.insert(stockMovements).values([
      { businessId: biz.id, productId: pepper, delta: nq(2), reason: "purchase", refId: purchase.id, refType: "purchase", note: "شراء رقم 1", createdAt: at(0.8), createdBy: ahmed.id },
    ]);
    await db.insert(supplierLedger).values({
      businessId: biz.id,
      supplierId: roaster.id,
      amount: n(56000),
      kind: "purchase",
      refId: purchase.id,
      refType: "purchase",
      note: "شراء رقم 1",
      createdAt: at(0.8),
      createdBy: ahmed.id,
    });

    await act(biz.id, ahmed.id, "أحمد شاكر", "cash_opened", "فتح الخزنة بمبلغ ٣٬٠٠٠ ج.م", 2);
    await act(biz.id, ahmed.id, "أحمد شاكر", "sale_created", "فاتورة رقم 1 — زعتر ٠٫٧٥ كجم — ١٣٥ ج.م", 1.5);
    await act(biz.id, ahmed.id, "أحمد شاكر", "sale_created", "فاتورة رقم 2 — كمون ٠٫٥ كجم — ١٣٠ ج.م", 1);
    await act(biz.id, ahmed.id, "أحمد شاكر", "purchase_created", "شراء رقم 1 — فلفل أسود ٢ كجم — ٥٦٠ ج.م (مدفوع ٢٠٠ ج.م)", 0.8);
    await act(biz.id, ahmed.id, "أحمد شاكر", "sale_created", "فاتورة رقم 3 — آجل على أم حسن — ٨٥ ج.م", 0.7);

    void turmeric;
    void hibiscus;
    void tea;
    void cinnamon;
    void cloves;
  }

  /* =========================== المحل العام =========================== */
  {
    const biz = await makeBiz(generalBiz.id);
    await createCatalog(biz, [
      { name: "ملابس", emoji: "👕" },
      { name: "أحذية", emoji: "👟" },
      { name: "إكسسوارات", emoji: "👜" },
    ]);
    const parent = await addProduct(biz, { name: "قميص قطني أبيض", cat: "ملابس", sale: 25000, cost: 18000, unit: "piece", stock: 0, archived: true });
    const shirtM = await addProduct(biz, { name: "قميص قطني أبيض — M", cat: "ملابس", sale: 25000, cost: 18000, unit: "piece", stock: 6, reorder: 3, parentId: parent });
    const shirtL = await addProduct(biz, { name: "قميص قطني أبيض — L", cat: "ملابس", sale: 25500, cost: 18000, unit: "piece", stock: 8, reorder: 3, parentId: parent });
    const shirtXL = await addProduct(biz, { name: "قميص قطني أبيض — XL", cat: "ملابس", sale: 26000, cost: 18000, unit: "piece", stock: 10, reorder: 3, parentId: parent });
    const jeans = await addProduct(biz, { name: "بنطلون جينز", cat: "ملابس", sale: 45000, cost: 32000, unit: "piece", stock: 8, reorder: 4 });
    const shoes = await addProduct(biz, { name: "حذاء رياضي", cat: "أحذية", sale: 70000, cost: 50000, unit: "piece", stock: 5, reorder: 2 });
    const bag = await addProduct(biz, { name: "حقيبة جلد", cat: "إكسسوارات", sale: 38000, cost: 26000, unit: "piece", stock: 4, reorder: 2 });
    const belt = await addProduct(biz, { name: "حزام جلد", cat: "إكسسوارات", sale: 15000, cost: 9000, unit: "piece", stock: 6, reorder: 3 });

    const [samy] = await db
      .insert(customers)
      .values({ businessId: biz.id, name: "سامي أحمد", phone: "01229998888" })
      .returning();

    const [session] = await db
      .insert(cashSessions)
      .values({ businessId: biz.id, opening: n(200000), status: "open", openedAt: at(2), openedBy: ahmed.id })
      .returning();
    await db.insert(cashMovements).values([
      { businessId: biz.id, sessionId: session.id, type: "opening", amount: n(200000), createdAt: at(2), createdBy: ahmed.id },
      { businessId: biz.id, sessionId: session.id, type: "sale_refund", amount: n(-15000), note: "مرتجع فاتورة رقم 1", refId: 1, refType: "return", createdAt: at(1.2), createdBy: ahmed.id },
      { businessId: biz.id, sessionId: session.id, type: "expense", amount: n(-10000), note: "إيجار — إيجار المحل", createdAt: at(0.7), createdBy: ahmed.id },
    ]);
    await sale(biz, { num: 1, hoursAgo: 1.5, method: "cash", sessionId: session.id, actorId: sara.id, items: [{ pid: shirtL, qty: 1, price: 25500, cost: 18000 }, { pid: belt, qty: 1, price: 15000, cost: 9000 }] });

    const [ret] = await db
      .insert(returns)
      .values({
        businessId: biz.id,
        saleId: 1,
        customerId: null,
        total: n(15000),
        refundMethod: "cash",
        note: "مقاس غير مناسب",
        createdAt: at(1.2),
        createdBy: ahmed.id,
      })
      .returning();
    await db.insert(returnItems).values({
      returnId: ret.id,
      productId: belt,
      productName: "حزام جلد",
      qty: nq(1),
      unitPrice: n(15000),
      total: n(15000),
    });
    await db.insert(stockMovements).values({
      businessId: biz.id,
      productId: belt,
      delta: nq(1),
      reason: "sale_return",
      refId: ret.id,
      refType: "return",
      note: "مرتجع فاتورة رقم 1",
      createdAt: at(1.2),
      createdBy: ahmed.id,
    });

    await sale(biz, { num: 2, hoursAgo: 1, method: "credit", sessionId: session.id, actorId: sara.id, customerId: samy.id, items: [{ pid: jeans, qty: 1, price: 45000, cost: 32000 }] });
    await db.insert(expenses).values({
      businessId: biz.id,
      amount: n(10000),
      category: "إيجار",
      note: "إيجار المحل",
      createdAt: at(0.7),
      createdBy: ahmed.id,
    });

    await act(biz.id, ahmed.id, "أحمد شاكر", "cash_opened", "فتح الخزنة بمبلغ ٢٬٠٠٠ ج.م", 2);
    await act(biz.id, sara.id, "سارة كمال", "sale_created", "فاتورة رقم 1 — ٤٠٥ ج.م (مدفوع)", 1.5);
    await act(biz.id, ahmed.id, "أحمد شاكر", "sale_return", "مرتجع ١٥٠ ج.م من الفاتورة رقم 1 — مقاس غير مناسب", 1.2);
    await act(biz.id, sara.id, "سارة كمال", "sale_created", "فاتورة رقم 2 — آجل على سامي أحمد — ٤٥٠ ج.م", 1);
    await act(biz.id, ahmed.id, "أحمد شاكر", "expense_recorded", "مصروف إيجار — ١٠٠ ج.م", 0.7);

    void shirtM;
    void shirtXL;
    void shoes;
    void bag;
  }

  console.log("[seed] تم تجهيز البيانات التجريبية: 3 أنشطة + 3 مستخدمين (كلمة المرور: 1234)");
  return true;
}
