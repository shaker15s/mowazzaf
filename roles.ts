/* الأدوار والصلاحيات — خفيف وآمن للعميل والخادم (بدون قاعدة بيانات) */

export type Role = "owner" | "manager" | "cashier" | "inventory";

export type Perm =
  | "sale"
  | "void_sale"
  | "return_sale"
  | "products"
  | "purchases"
  | "expenses"
  | "cash"
  | "reports"
  | "employees"
  | "assistant";

const PERMISSIONS: Record<Perm, Role[]> = {
  sale: ["owner", "manager", "cashier"],
  void_sale: ["owner", "manager"],
  return_sale: ["owner", "manager"],
  products: ["owner", "manager", "inventory"],
  purchases: ["owner", "manager", "inventory"],
  expenses: ["owner", "manager"],
  cash: ["owner", "manager"],
  reports: ["owner", "manager"],
  employees: ["owner"],
  assistant: ["owner", "manager", "cashier"],
};

export const can = (role: Role | undefined | null, perm: Perm): boolean =>
  !!role && PERMISSIONS[perm].includes(role);

export const ROLE_LABELS: Record<Role, string> = {
  owner: "صاحب النشاط",
  manager: "مدير",
  cashier: "كاشير",
  inventory: "أمين مخزن",
};
