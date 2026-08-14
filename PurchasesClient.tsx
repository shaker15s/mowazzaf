"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge, Icon, Btn, Modal, Input, Field, Select, Empty } from "@/components/ui";
import { createPurchase } from "@/lib/engine";
import { fmtMoney, fmtQty, fmtDateTime } from "@/lib/money";

type PurchRow = {
  id: number;
  number: number;
  total: number;
  paid: number;
  note: string | null;
  at: Date;
  supplierId: number | null;
  supplierName: string | null;
  items: { id: number; name: string; qty: number; unitCost: number; total: number }[];
};

export default function PurchasesClient({
  purchases,
  canCreate,
  products,
  suppliers,
}: {
  purchases: PurchRow[];
  canCreate: boolean;
  products: { id: number; name: string; costPrice: number }[];
  suppliers: { id: number; name: string; balance: number }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState(0);
  const [paid, setPaid] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<{ key: number; productId: number; name: string; qty: string; cost: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const addRow = () =>
    setRows((r) => [...r, { key: Date.now(), productId: 0, name: "", qty: "1", cost: "" }]);
  const updateRow = (key: number, patch: Partial<(typeof rows)[number]>) =>
    setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const removeRow = (key: number) => setRows((r) => r.filter((x) => x.key !== key));

  const total = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.cost) || 0), 0),
    [rows],
  );

  const submit = async () => {
    setBusy(true);
    setError("");
    const valid = rows.filter((r) => r.productId > 0 && (Number(r.qty) || 0) > 0 && (Number(r.cost) || 0) >= 0);
    const res = await createPurchase({
      supplierId: supplierId || undefined,
      items: valid.map((r) => ({
        productId: r.productId,
        name: r.name,
        qty: Number(r.qty) || 0,
        unitCost: Number(r.cost) || 0,
      })),
      paid: Number(paid) || 0,
      note: note || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setOpen(false);
    setRows([]);
    setPaid("");
    setNote("");
    setSupplierId(0);
    router.refresh();
  };

  return (
    <div className="fade-up space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">الشراء</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            الشراء يزيد المخزون — والآجل يزيد رصيد المورد، والمدفوع يتخصم من الخزنة
          </p>
        </div>
        {canCreate && (
          <Btn onClick={() => { setOpen(true); setError(""); }}>
            <Icon name="plus" size={16} />
            تسجيل شراء
          </Btn>
        )}
      </div>

      <Card pad={false}>
        {purchases.length === 0 ? (
          <Empty icon="purchase" title="مفيش مشتريات لسه" desc="سجّل أول شراء وحدد الأصناف عشان المخزون يزيد تلقائيًا." />
        ) : (
          <ul className="divide-y divide-slate-50">
            {purchases.map((p) => (
              <li key={p.id}>
                <details className="group px-5 py-4">
                  <summary className="flex cursor-pointer list-none items-center gap-3">
                    <Badge tone="gray">#{p.number}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-black text-slate-800">
                        {fmtMoney(p.total)}
                        <span className="mr-2 text-[11px] font-bold text-slate-400">{p.supplierName ?? "بدون مورد"}</span>
                      </p>
                      <p className="text-[11px] text-slate-400">{fmtDateTime(p.at)}</p>
                    </div>
                    {p.paid < p.total ? (
                      <Badge tone="amber">باقي {fmtMoney(p.total - p.paid)}</Badge>
                    ) : (
                      <Badge tone="green">خالص</Badge>
                    )}
                    <Icon name="chevron" size={15} className="text-slate-300 transition group-open:rotate-180" />
                  </summary>
                  <div className="mt-3 space-y-1.5 rounded-xl bg-slate-50 p-3">
                    {p.items.length === 0 && <p className="text-xs text-slate-400">شراء بدون أصناف — المخزون لم يزد</p>}
                    {p.items.map((i) => (
                      <div key={i.id} className="flex justify-between text-xs">
                        <span className="font-bold text-slate-600">
                          {i.name} ×{fmtQty(i.qty)}
                        </span>
                        <span className="text-slate-500">
                          {fmtMoney(i.unitCost)}/وحدة — {fmtMoney(i.total)}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* تسجيل شراء */}
      <Modal open={open} onClose={() => setOpen(false)} title="تسجيل شراء" wide>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="المورد">
              <Select value={supplierId || ""} onChange={(e) => setSupplierId(Number(e.target.value) || 0)}>
                <option value="">بدون مورد</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.balance > 0 ? ` (عليه ${fmtMoney(s.balance)})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="المدفوع نقدًا الآن" hint={`الإجمالي ${fmtMoney(total)} — الباقي آجل على المورد`}>
              <Input type="number" step="0.5" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder="0" />
            </Field>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-black text-slate-500">الأصناف والكميات</p>
              <button onClick={addRow} className="text-xs font-black text-emerald-700 hover:underline">
                + صنف
              </button>
            </div>
            {rows.length === 0 && (
              <p className="rounded-xl border-2 border-dashed border-slate-200 px-4 py-4 text-center text-xs text-slate-400">
                لو مش عايز تسجل أصناف دلوقتي، سيبها فاضية وسجّل الشراء كإجمالي — بس المخزون مش هيزيد.
              </p>
            )}
            {rows.map((r) => (
              <div key={r.key} className="flex items-center gap-2">
                <Select
                  value={r.productId || ""}
                  onChange={(e) => {
                    const pid = Number(e.target.value) || 0;
                    const p = products.find((x) => x.id === pid);
                    updateRow(r.key, { productId: pid, name: p?.name ?? "", cost: p ? String(p.costPrice || "") : r.cost });
                  }}
                  className="flex-1"
                >
                  <option value="">اختر المنتج…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
                <Input
                  type="number"
                  min={0}
                  step="0.25"
                  value={r.qty}
                  onChange={(e) => updateRow(r.key, { qty: e.target.value })}
                  placeholder="كمية"
                  className="w-20 text-center"
                />
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  value={r.cost}
                  onChange={(e) => updateRow(r.key, { cost: e.target.value })}
                  placeholder="تكلفة"
                  className="w-24 text-center"
                />
                <button onClick={() => removeRow(r.key)} className="text-slate-300 hover:text-red-500">
                  <Icon name="x" size={16} />
                </button>
              </div>
            ))}
          </div>

          <Field label="ملاحظة (اختياري)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: دفعة مقدم" />
          </Field>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
          <Btn className="w-full" size="lg" loading={busy} onClick={submit} disabled={total <= 0 && rows.length > 0 && false}>
            حفظ الشراء {total > 0 && `(${fmtMoney(total)})`}
          </Btn>
        </div>
      </Modal>
    </div>
  );
}
