import { requireAuth } from "@/lib/auth";
import { getTimelinePage } from "@/lib/queries";
import { fmtDateTime, fmtDateShort } from "@/lib/money";
import { Card, Icon, Empty, Badge } from "@/components/ui";

const ACTION_META: Record<string, { icon: string; tone: "green" | "red" | "amber" | "blue" | "gray" }> = {
  sale_created: { icon: "pos", tone: "green" },
  sale_voided: { icon: "trash", tone: "red" },
  sale_return: { icon: "refresh", tone: "blue" },
  purchase_created: { icon: "purchase", tone: "blue" },
  expense_recorded: { icon: "expense", tone: "red" },
  customer_payment: { icon: "coins", tone: "green" },
  supplier_payment: { icon: "coins", tone: "amber" },
  cash_opened: { icon: "cash", tone: "green" },
  cash_closed: { icon: "cash", tone: "gray" },
  cash_adjustment: { icon: "edit", tone: "amber" },
  cash_in: { icon: "plus", tone: "green" },
  cash_out: { icon: "minus", tone: "red" },
  product_created: { icon: "products", tone: "blue" },
  product_updated: { icon: "edit", tone: "amber" },
  stock_adjusted: { icon: "weight", tone: "amber" },
  customer_created: { icon: "customers", tone: "blue" },
  supplier_created: { icon: "suppliers", tone: "blue" },
  employee_added: { icon: "employees", tone: "blue" },
  employee_role_changed: { icon: "employees", tone: "amber" },
  employee_removed: { icon: "employees", tone: "red" },
};

export default async function TimelinePage() {
  const auth = await requireAuth();
  const rows = await getTimelinePage(auth.business.id);
  let lastDay = "";

  return (
    <div className="fade-up space-y-4">
      <div>
        <h1 className="text-2xl font-black text-slate-900">السجل الزمني</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          كل حركة في المحل — مين عملها وإمتى — عشان تعرف تراجع أي حاجة
        </p>
      </div>

      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty icon="timeline" title="السجل فاضي" desc="أول عملية هتظهر هنا بتوقيتها واسم اللي عملها." />
        ) : (
          <ul className="divide-y divide-slate-50">
            {rows.map((t) => {
              const meta = ACTION_META[t.action] ?? { icon: "info", tone: "gray" as const };
              const day = fmtDateShort(t.at);
              const showDay = day !== lastDay;
              lastDay = day;
              return (
                <li key={t.id} className="px-5 py-3.5">
                  {showDay && (
                    <p className="mb-2.5 text-[11px] font-black text-slate-400">{day}</p>
                  )}
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 shrink-0 rounded-xl p-2 ${meta.tone === "green" ? "bg-emerald-50 text-emerald-600" : meta.tone === "red" ? "bg-red-50 text-red-500" : meta.tone === "amber" ? "bg-amber-50 text-amber-600" : "bg-sky-50 text-sky-600"}`}>
                      <Icon name={meta.icon} size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-800">{t.summary ?? t.action}</p>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {t.actorName ?? "—"} · {fmtDateTime(t.at)}
                      </p>
                    </div>
                    <Badge tone={meta.tone}>{t.action}</Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
