import {
  pgTable,
  serial,
  integer,
  text,
  varchar,
  timestamp,
  boolean,
  numeric,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* المال: نخزّن كـ numeric(12,2) ونحسب داخليًا بالقرش (عدد صحيح) */
/* ------------------------------------------------------------------ */
const money = (name: string) =>
  numeric(name, { precision: 12, scale: 2 }).notNull().default("0");
const moneyN = (name: string) => numeric(name, { precision: 12, scale: 2 });
const qty = (name: string) =>
  numeric(name, { precision: 10, scale: 3 }).notNull().default("0");

/* ------------------------------- Core ------------------------------ */
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const businesses = pgTable("businesses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: varchar("type", { length: 20 })
    .$type<"supermarket" | "attara" | "general">()
    .notNull(),
  hasEmployees: boolean("has_employees").notNull().default(false),
  sellsOnCredit: boolean("sells_on_credit").notNull().default(false),
  manageInventory: boolean("manage_inventory").notNull().default(false),
  usesBarcode: boolean("uses_barcode").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const usersBusinesses = pgTable(
  "users_businesses",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    businessId: integer("business_id")
      .notNull()
      .references(() => businesses.id),
    role: varchar("role", { length: 20 })
      .$type<"owner" | "manager" | "cashier" | "inventory">()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("users_businesses_uniq").on(t.userId, t.businessId),
    index("ub_business_idx").on(t.businessId),
  ],
);

/* ------------------------------ Catalog ---------------------------- */
export const categories = pgTable(
  "categories",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id")
      .notNull()
      .references(() => businesses.id),
    name: text("name").notNull(),
    emoji: text("emoji"),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("cat_business_idx").on(t.businessId)],
);

export const units = pgTable(
  "units",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id")
      .notNull()
      .references(() => businesses.id),
    name: text("name").notNull(),
    symbol: text("symbol").notNull(),
    kind: varchar("kind", { length: 20 })
      .$type<"piece" | "kg" | "gram" | "liter" | "carton">()
      .notNull()
      .default("piece"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("units_business_idx").on(t.businessId)],
);

export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id")
      .notNull()
      .references(() => businesses.id),
    name: text("name").notNull(),
    categoryId: integer("category_id").references(() => categories.id),
    unitId: integer("unit_id")
      .notNull()
      .references(() => units.id),
    salePrice: money("sale_price"),
    costPrice: moneyN("cost_price"),
    barcode: varchar("barcode", { length: 40 }),
    isWeighted: boolean("is_weighted").notNull().default(false),
    reorderPoint: numeric("reorder_point", { precision: 10, scale: 3 })
      .notNull()
      .default("0"),
    parentId: integer("parent_id"),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("products_business_idx").on(t.businessId),
    index("products_barcode_idx").on(t.barcode),
  ],
);

/* ----------------------------- Parties ----------------------------- */
export const customers = pgTable(
  "customers",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id")
      .notNull()
      .references(() => businesses.id),
    name: text("name").notNull(),
    phone: text("phone"),
    creditLimit: moneyN("credit_limit"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("customers_business_idx").on(t.businessId)],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id")
      .notNull()
      .references(() => businesses.id),
    name: text("name").notNull(),
    phone: text("phone"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("suppliers_business_idx").on(t.businessId)],
);

/* --------------------------- Ledgers (دائمًا حركات، لا أرصدة mutable) --------------------------- */
export const customerLedger = pgTable(
  "customer_ledger",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id")
      .notNull()
      .references(() => businesses.id),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id),
    amount: money("amount"), // موجب = عليه دين، سالب = دفع/مرتجع
    kind: varchar("kind", { length: 20 })
      .$type<"sale" | "payment" | "return" | "void">()
      .notNull(),
    refId: integer("ref_id"),
    refType: text("ref_type"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: integer("created_by").references(() => users.id),
  },
  (t) => [
    index("cl_business_idx").on(t.businessId),
    index("cl_customer_idx").on(t.customerId),
  ],
);

export const supplierLedger = pgTable(
  "supplier_ledger",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id")
      .notNull()
      .references(() => businesses.id),
    supplierId: integer("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    amount: money("amount"), // موجب = عليه فاتورة، سالب = دفع/مرتجع
    kind: varchar("kind", { length: 20 })
      .$type<"purchase" | "payment" | "return">()
      .notNull(),
    refId: integer("ref_id"),
    refType: text("ref_type"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: integer("created_by").references(() => users.id),
  },
  (t) => [
    index("sl_business_idx").on(t.businessId),
    index("sl_supplier_idx").on(t.supplierId),
  ],
);

/* ------------------------------- Sales ----------------------------- */
export const sales = pgTable(
  "sales",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id")
      .notNull()
      .references(() => businesses.id),
    number: integer("number").notNull().default(1),
    kind: varchar("kind", { length: 20 })
      .$type<"detailed" | "quick">()
      .notNull(),
    customerId: integer("customer_id").references(() => customers.id),
    status: varchar("status", { length: 20 })
      .$type<"completed" | "voided">()
      .notNull()
      .default("completed"),
    total: money("total"),
    discount: money("discount"),
    paid: money("paid"),
    method: varchar("method", { length: 20 })
      .$type<"cash" | "card" | "wallet" | "credit">()
      .notNull(),
    note: text("note"),
    clientRef: varchar("client_ref", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: integer("created_by").references(() => users.id),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
  },
  (t) => [
    index("sales_business_idx").on(t.businessId, t.createdAt),
    uniqueIndex("sales_clientref_idx").on(t.businessId, t.clientRef),
  ],
);

export const saleItems = pgTable(
  "sale_items",
  {
    id: serial("id").primaryKey(),
    saleId: integer("sale_id")
      .notNull()
      .references(() => sales.id),
    productId: integer("product_id").references(() => products.id),
    productName: text("product_name").notNull(),
    qty: qty("qty"),
    unitPrice: money("unit_price"),
    unitCost: moneyN("unit_cost"),
    total: money("total"),
    isWeighted: boolean("is_weighted").notNull().default(false),
  },
  (t) => [index("si_sale_idx").on(t.saleId)],
);

export const payments = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id")
      .notNull()
      .references(() => businesses.id),
    saleId: integer("sale_id").references(() => sales.id),
    amount: money("amount"),
    method: varchar("method", { length: 20 })
      .$type<"cash" | "card" | "wallet" | "other">()
      .notNull(),
    voided: boolean("voided").notNull().default(false),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: integer("created_by").references(() => users.id),
  },
  (t) => [index("payments_business_idx").on(t.businessId)],
);

export const returns = pgTable(
  "returns",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id")
      .notNull()
      .references(() => businesses.id),
    saleId: integer("sale_id")
      .notNull()
      .references(() => sales.id),
    customerId: integer("customer_id").references(() => customers.id),
    total: money("total"),
    refundMethod: varchar("refund_method", { length: 20 })
      .$type<"cash" | "card" | "wallet" | "credit">()
      .notNull()
      .default("cash"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: integer("created_by").references(() => users.id),
  },
  (t) => [index("returns_sale_idx").on(t.saleId)],
);

export const returnItems = pgTable(
  "return_items",
  {
    id: serial("id").primaryKey(),
    returnId: integer("return_id")
      .notNull()
      .references(() => returns.id),
    saleItemId: integer("sale_item_id").references(() => saleItems.id),
    productId: integer("product_id").references(() => products.id),
    productName: text("product_name").notNull(),
    qty: qty("qty"),
    unitPrice: money("unit_price"),
    total: money("total"),
  },
  (t) => [index("ri_return_idx").on(t.returnId)],
);

/* ----------------------------- Purchases --------------------------- */
export const purchases = pgTable(
  "purchases",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id")
      .notNull()
      .references(() => businesses.id),
    number: integer("number").notNull().default(1),
    supplierId: integer("supplier_id").references(() => suppliers.id),
    total: money("total"),
    paid: money("paid"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: integer("created_by").references(() => users.id),
  },
  (t) => [index("purchases_business_idx").on(t.businessId, t.createdAt)],
);

export const purchaseItems = pgTable(
  "purchase_items",
  {
    id: serial("id").primaryKey(),
    purchaseId: integer("purchase_id")
      .notNull()
      .references(() => purchases.id),
    productId: integer("product_id").references(() => products.id),
    productName: text("product_name").notNull(),
    qty: qty("qty"),
    unitCost: money("unit_cost"),
    total: money("total"),
  },
  (t) => [index("pi_purchase_idx").on(t.purchaseId)],
);

/* ------------------------------ Cash ------------------------------- */
export const cashSessions = pgTable(
  "cash_sessions",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id")
      .notNull()
      .references(() => businesses.id),
    opening: money("opening"),
    note: text("note"),
    status: varchar("status", { length: 20 })
      .$type<"open" | "closed">()
      .notNull()
      .default("open"),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    expected: moneyN("expected"),
    actual: moneyN("actual"),
    variance: moneyN("variance"),
    closeNote: text("close_note"),
    openedBy: integer("opened_by").references(() => users.id),
    closedBy: integer("closed_by").references(() => users.id),
  },
  (t) => [index("cs_business_idx").on(t.businessId)],
);

export const cashMovements = pgTable(
  "cash_movements",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id")
      .notNull()
      .references(() => businesses.id),
    sessionId: integer("session_id").references(() => cashSessions.id),
    type: varchar("type", { length: 30 })
      .$type<
        | "opening"
        | "cash_sale"
        | "collection"
        | "other_in"
        | "cash_purchase"
        | "expense"
        | "supplier_payment"
        | "withdrawal"
        | "sale_refund"
        | "adjustment"
      >()
      .notNull(),
    amount: money("amount"), // موجب = دخول، سالب = خروج
    note: text("note"),
    refId: integer("ref_id"),
    refType: text("ref_type"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: integer("created_by").references(() => users.id),
  },
  (t) => [index("cm_business_idx").on(t.businessId, t.createdAt)],
);

export const expenses = pgTable(
  "expenses",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id")
      .notNull()
      .references(() => businesses.id),
    amount: money("amount"),
    category: text("category").notNull().default("أخرى"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: integer("created_by").references(() => users.id),
  },
  (t) => [index("expenses_business_idx").on(t.businessId, t.createdAt)],
);

/* ----------------------------- Inventory --------------------------- */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id")
      .notNull()
      .references(() => businesses.id),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    delta: qty("delta"), // موجب = دخول، سالب = خروج
    reason: varchar("reason", { length: 30 })
      .$type<
        | "opening"
        | "purchase"
        | "sale"
        | "sale_return"
        | "adjustment"
        | "void"
      >()
      .notNull(),
    refId: integer("ref_id"),
    refType: text("ref_type"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: integer("created_by").references(() => users.id),
  },
  (t) => [
    index("sm_business_idx").on(t.businessId, t.createdAt),
    index("sm_product_idx").on(t.productId),
  ],
);

/* ------------------------------- Audit ----------------------------- */
export const activityLog = pgTable(
  "activity_log",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id")
      .notNull()
      .references(() => businesses.id),
    actorId: integer("actor_id").references(() => users.id),
    actorName: text("actor_name"),
    action: text("action").notNull(),
    summary: text("summary"),
    refId: integer("ref_id"),
    refType: text("ref_type"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("al_business_idx").on(t.businessId, t.createdAt)],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id")
      .notNull()
      .references(() => businesses.id),
    key: text("key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("idem_key_idx").on(t.businessId, t.key)],
);
