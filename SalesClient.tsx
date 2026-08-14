"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge, Icon, Btn, Modal, Input, Field, Select, Empty } from "@/components/ui";
import { voidSale, returnSale } from "@/lib/engine";
import { fmtMoney, fmtQty, fmtDateTime, METHOD_LABELS } from "@/lib/money";

type SaleRow = {
  id: number;
  number: number;
  kind: "detailed" | "quick";
  status: "completed" | "voided";
  total: number;
  discount: number;
  paid: number;
  method: string;
  returned: number;
  at: Date;
  actorName: string | null;
  customerId: number | null;
  customerName: string | null;
  items: { id: number; productId: number | null; name: string; qty: number; unitPrice: number; total: number }[];
};

export default function SalesClient({
  sales,
  canVoid,
  canReturn,
}: {
  sales: SaleRow[];
  canVoid: boolean;
  canReturn: boolean;
}) {
  const router = useRouter();
  const [voidTarget, setVoidTarget] = useState<SaleRow | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [returnTarget, setReturnTarget] = useState<SaleRow | null>(null);
  const [returnQtys, setReturnQtys] = useState<Record<number, number>>({});
  const [refundMethod, setRefundMethod] = useState("cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "today">("all");

  const todayStr = new Date().toISOString().slice(0, 10);
  const shown = filter === "today" ? sales.filter((s) => new Date(s.at).toISOString().slice(0, 10) === todayStr) : sales;
  const todayTotal = sales
    .filter((s) => new Date(s.at).toISOString().slice(0, 10) === todayStr && s.status === "completed")
    .reduce((sum, s) => sum + s.total - s.returned, 0);

  const doVoid = async () => {
    if (!voidTarget) return;
    setBusy(true);
    setError("");
    const res = await voidSale(voidTarget.id, voidReason);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setVoidTarget(null);
    setVoidReason("");
    router.refresh();
  };

  const returnItems = (returnTarget?.items ?? []).filter((i) => i.productId !== null);
  const returnTotal = returnItems.reduce((s, i) => s + (returnQtys[i.id] || 0) * i.unitPrice, 0);

  const doReturn = async () => {
    if (!returnTarget) return;
    const items = returnItems
      .filter((i) => (returnQtys[i.id] || 0) > 0)
      .map((i) => ({ saleItemId: i.id, qty: returnQtys[i.id] }));
    if (items.length === 0) {
      setError("حدد كميات المرتجع.");
      return;
    }
    setBusy(true);
    setError("");
    const res = await returnSale({
      saleId: returnTarget.id,
      items,
      refundMethod: refundMethod as "cash" | "card" | "wallet" | "credit",
      note: "مرتجع من صفحة المبيعات",
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setReturnTarget(null);
    setReturnQtys({});
    router.refresh();
  };

  return (
    <div className="fade-up space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">المبيعات</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            إجمالي اليوم: <b className="text-emerald-700">{fmtMoney(todayTotal)}</b>
          </p>
        </div>
        <div className="flex rounded-xl border border-slate-200 bg-white p-1">
          {(["all", "today"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-4 py-1.5 text-xs font-black transition ${filter === f ? "bg-slate-900 text-white" : "text-slate-500"}`}
            >
              {f === "all" ? "الكل" : "اليوم"}
            </button>
          ))}
        </div>
      </div>

      <Card pad={false}>
        {shown.length === 0 ? (
          <Empty icon="sales" title="مفيش فواتير هنا" desc="ابدأ أول بيع من نقطة البيع." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-right text-[11px] text-slate-400">
                  <th className="px-4 py-3 font-bold">رقم</th>
                  <th className="px-4 py-3 font-bold">الوقت</th>
                  <th className="px-4 py-3 font-bold">الأصناف</th>
                  <th className="px-4 py-3 font-bold">العميل</th>
                  <th className="px-4 py-3 font-bold">الإجمالي</th>
                  <th className="px-4 py-3 font-bold">الدفع</th>
                  <th className="px-4 py-3 font-bold">الحالة</th>
                  {(canVoid || canReturn) && <th className="px-4 py-3 font-bold">إجراءات</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {shown.map((s) => (
                  <tr key={s.id} className="transition hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-black text-slate-800">#{s.number}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{fmtDateTime(s.at)}</td>
                    <td className="max-w-[220px] px-4 py-3">
                      {s.kind === "quick" ? (
                        <Badge tone="gray">بيع سريع</Badge>
                      ) : (
                        <span className="truncate text-xs text-slate-600">
                          {s.items.slice(0, 2).map((i) => `${i.name} ×${fmtQty(i.qty)}`).join("، ")}
                          {s.items.length > 2 && " …"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{s.customerName ?? "—"}</td>
                    <td className="px-4 py-3 font-black text-slate-800">{fmtMoney(s.total)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={s.method === "credit" ? "amber" : "green"}>{METHOD_LABELS[s.method]}</Badge>
                      {s.method === "credit" && <span className="mr-1 text-[10px] text-slate-400">باقي {fmtMoney(s.total - s.paid)}</span>}
                    </td>
                    <td className="px-4 py-3">
                      {s.status === "voided" ? (
                        <Badge tone="red">ملغاة</Badge>
                      ) : s.returned > 0 ? (
                        <Badge tone="blue">مرتجع {fmtMoney(s.returned)}</Badge>
                      ) : (
                        <Badge tone="green">مكتملة</Badge>
                      )}
                    </td>
                    {(canVoid || canReturn) && s.status === "completed" && (
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          {canReturn && s.kind === "detailed" && (
                            <button
                              onClick={() => {
                                setReturnTarget(s);
                                setReturnQtys({});
                                setError("");
                              }}
                              className="rounded-lg p-1.5 text-sky-600 transition hover:bg-sky-50"
                              title="مرتجع"
                            >
                              <Icon name="refresh" size={16} />
                            </button>
                          )}
                          {canVoid && (
                            <button
                              onClick={() => {
                                setVoidTarget(s);
                                setVoidReason("");
                                setError("");
                              }}
                              className="rounded-lg p-1.5 text-red-500 transition hover:bg-red-50"
                              title="إلغاء الفاتورة"
                            >
                              <Icon name="trash" size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* إلغاء فاتورة */}
      <Modal open={!!voidTarget} onClose={() => setVoidTarget(null)} title="إلغاء فاتورة 🚫">
        {voidTarget && (
          <div className="space-y-4">
            <p className="text-sm leading-6 text-slate-600">
              فاتورة <b>#{voidTarget.number}</b> بقيمة <b>{fmtMoney(voidTarget.total)}</b>
              {voidTarget.customerName ? ` على ${voidTarget.customerName}` : ""}.
              <br />
              الإلغاء هيرجع المخزون ويخفض الخزنة/رصيد العميل — ومش هيتمسح من السجل.
            </p>
            <Field label="سبب الإلغاء (اختياري)">
              <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="مثال: خطأ في الفاتورة" />
            </Field>
            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
            <div className="flex gap-2">
              <Btn variant="outline" className="flex-1" onClick={() => setVoidTarget(null)}>
                تراجع
              </Btn>
              <Btn variant="danger" className="flex-1" loading={busy} onClick={doVoid}>
                تأكيد الإلغاء
              </Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* مرتجع */}
      <Modal open={!!returnTarget} onClose={() => setReturnTarget(null)} title={`مرتجع من فاتورة #${returnTarget?.number ?? ""} ↩️`}>
        <div className="space-y-4">
          <div className="space-y-2">
            {returnItems.map((i) => (
              <div key={i.id} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-800">{i.name}</p>
                  <p className="text-[11px] text-slate-400">
                    المباع {fmtQty(i.qty)} × {fmtMoney(i.unitPrice)}
                  </p>
                </div>
                <Input
                  type="number"
                  min={0}
                  max={i.qty}
                  step={0.25}
                  value={returnQtys[i.id] || ""}
                  placeholder="0"
                  onChange={(e) => setReturnQtys((q) => ({ ...q, [i.id]: Math.min(Number(e.target.value) || 0, i.qty) }))}
                  className="w-20 py-1.5 text-center"
                />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <Field label="طريقة الرد">
              <Select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)} className="w-36">
                <option value="cash">نقدي</option>
                <option value="card">كارت</option>
                <option value="wallet">محفظة</option>
                <option value="credit">خصم من الحساب</option>
              </Select>
            </Field>
            <div className="text-left">
              <p className="text-[11px] text-slate-400">إجمالي المرتجع</p>
              <p className="text-lg font-black text-slate-900">{fmtMoney(returnTotal)}</p>
            </div>
          </div>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
          <Btn className="w-full" size="lg" loading={busy} onClick={doReturn} disabled={returnTotal <= 0}>
            تأكيد المرتجع ({fmtMoney(returnTotal)})
          </Btn>
        </div>
      </Modal>
    </div>
  );
}
