"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon, Badge, Logo } from "@/components/ui";
import { switchBusiness, logout } from "@/lib/engine";
import { ROLE_LABELS } from "@/lib/roles";
import type { Role } from "@/lib/roles";
import type { Alert } from "@/lib/queries";

type NavItem = { href: string; label: string; icon: string };

const NAV: Record<Role, NavItem[]> = {
  owner: [
    { href: "/", label: "الرئيسية", icon: "home" },
    { href: "/pos", label: "نقطة البيع", icon: "pos" },
    { href: "/sales", label: "المبيعات", icon: "sales" },
    { href: "/purchases", label: "الشراء", icon: "purchase" },
    { href: "/expenses", label: "المصروفات", icon: "expense" },
    { href: "/cash", label: "الخزنة", icon: "cash" },
    { href: "/customers", label: "العملاء", icon: "customers" },
    { href: "/suppliers", label: "الموردون", icon: "suppliers" },
    { href: "/products", label: "المنتجات", icon: "products" },
    { href: "/reports", label: "التقارير", icon: "reports" },
    { href: "/employees", label: "الموظفون", icon: "employees" },
    { href: "/timeline", label: "السجل الزمني", icon: "timeline" },
  ],
  manager: [
    { href: "/", label: "الرئيسية", icon: "home" },
    { href: "/pos", label: "نقطة البيع", icon: "pos" },
    { href: "/sales", label: "المبيعات", icon: "sales" },
    { href: "/purchases", label: "الشراء", icon: "purchase" },
    { href: "/expenses", label: "المصروفات", icon: "expense" },
    { href: "/cash", label: "الخزنة", icon: "cash" },
    { href: "/customers", label: "العملاء", icon: "customers" },
    { href: "/suppliers", label: "الموردون", icon: "suppliers" },
    { href: "/products", label: "المنتجات", icon: "products" },
    { href: "/reports", label: "التقارير", icon: "reports" },
    { href: "/timeline", label: "السجل الزمني", icon: "timeline" },
  ],
  cashier: [
    { href: "/pos", label: "نقطة البيع", icon: "pos" },
    { href: "/sales", label: "المبيعات", icon: "sales" },
    { href: "/products", label: "المنتجات", icon: "products" },
    { href: "/customers", label: "العملاء", icon: "customers" },
  ],
  inventory: [
    { href: "/", label: "الرئيسية", icon: "home" },
    { href: "/purchases", label: "الشراء", icon: "purchase" },
    { href: "/products", label: "المنتجات", icon: "products" },
    { href: "/suppliers", label: "الموردون", icon: "suppliers" },
    { href: "/timeline", label: "السجل الزمني", icon: "timeline" },
  ],
};

const ASSISTANT_LINK = { href: "/assistant", label: "المساعد", icon: "assistant" };

export default function Shell({
  user,
  business,
  role,
  memberships,
  alerts,
  children,
}: {
  user: { id: number; name: string };
  business: { id: number; name: string; type: string };
  role: Role;
  memberships: { businessId: number; businessName: string; role: Role }[];
  alerts: Alert[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);

  const items = [...(NAV[role] ?? NAV.owner), ASSISTANT_LINK];
  const sevTone: Record<"info" | "warn" | "danger", "blue" | "amber" | "red"> = {
    info: "blue",
    warn: "amber",
    danger: "red",
  };

  const doSwitch = async (businessId: number) => {
    await switchBusiness(businessId);
  };

  return (
    <div className="min-h-screen bg-[#f6f5f2]">
      {/* الشريط الجانبي */}
      <aside
        className={`fixed inset-y-0 right-0 z-40 w-64 bg-slate-900 text-slate-300 transition-transform lg:translate-x-0 ${menuOpen ? "translate-x-0" : "translate-x-full"} flex flex-col`}
      >
        <div className="flex items-center gap-3 px-5 py-5">
          <Logo size={38} />
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold text-white">{business.name}</p>
            <p className="text-[11px] text-emerald-400">مساعد التاجر</p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {items.map((it) => {
            const active = pathname === it.href;
            return (
              <a
                key={it.href}
                href={it.href}
                onClick={() => setMenuOpen(false)}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${active ? "bg-emerald-500/15 text-emerald-300" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}
              >
                <Icon name={it.icon} size={19} />
                {it.label}
                {active && <span className="mr-auto h-1.5 w-1.5 rounded-full bg-emerald-400" />}
              </a>
            );
          })}
        </nav>
        <div className="border-t border-white/10 px-4 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600/20 text-sm font-black text-emerald-300">
              {user.name.charAt(0)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-white">{user.name}</p>
              <p className="text-[11px] text-slate-400">{ROLE_LABELS[role]}</p>
            </div>
            <button
              onClick={async () => {
                await logout();
              }}
              className="rounded-lg p-2 text-slate-400 transition hover:bg-white/10 hover:text-red-400"
              title="تسجيل خروج"
            >
              <Icon name="logout" size={17} />
            </button>
          </div>
        </div>
      </aside>

      {menuOpen && (
        <div className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden" onClick={() => setMenuOpen(false)} />
      )}

      {/* المحتوى */}
      <div className="lg:pr-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/85 px-4 backdrop-blur lg:px-8">
          <button
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="القائمة"
          >
            <Icon name="sales" size={20} />
          </button>
          <div className="hidden items-center gap-2 sm:flex">
            <Badge tone="green" className="px-2.5 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {business.type === "supermarket" ? "سوبر ماركت" : business.type === "attara" ? "عطارة" : "محل عام"}
            </Badge>
          </div>
          <div className="mr-auto flex items-center gap-1.5">
            {memberships.length > 1 && (
              <select
                className="max-w-[180px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold text-slate-700 outline-none"
                value={business.id}
                onChange={(e) => doSwitch(Number(e.target.value))}
              >
                {memberships.map((m) => (
                  <option key={m.businessId} value={m.businessId}>
                    {m.businessName}
                  </option>
                ))}
              </select>
            )}
            <div className="relative">
              <button
                className="relative rounded-lg p-2 text-slate-500 transition hover:bg-slate-100"
                onClick={() => setBellOpen((v) => !v)}
                aria-label="التنبيهات"
              >
                <Icon name="bell" size={19} />
                {alerts.length > 0 && (
                  <span className="absolute left-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white">
                    {alerts.length > 9 ? "9+" : alerts.length}
                  </span>
                )}
              </button>
              {bellOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setBellOpen(false)} />
                  <div className="absolute left-0 z-20 mt-2 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                    <div className="border-b border-slate-100 px-4 py-3">
                      <p className="text-sm font-extrabold text-slate-900">محتاج انتباهك</p>
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {alerts.length === 0 && (
                        <p className="px-4 py-6 text-center text-sm text-slate-500">كله تمام ✅ مفيش تنبيهات</p>
                      )}
                      {alerts.map((a) => (
                        <a
                          key={a.id}
                          href={a.href ?? "#"}
                          onClick={() => setBellOpen(false)}
                          className="flex gap-2.5 border-b border-slate-50 px-4 py-3 transition hover:bg-slate-50"
                        >
                          <Badge tone={sevTone[a.severity] ?? "gray"} className="mt-0.5 shrink-0">
                            {a.severity === "danger" ? "!" : a.severity === "warn" ? "؟" : "i"}
                          </Badge>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-800">{a.title}</p>
                            {a.body && <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{a.body}</p>}
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
