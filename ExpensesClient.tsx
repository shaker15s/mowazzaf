"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge, Icon, Btn, Input, Field, Select, Empty } from "@/components/ui";
import { recordExpense } from "@/lib/engine";
import { fmtMoney, fmtDateTime, EXPENSE_CATEGORIES } from "@/lib/money";

export default function ExpensesClient({
  data,
  canCreate,
}: {
  data: { monthTotal: number; expenses: { id: number; amount: number; category: string; note: string | null; at: Date; isToday: boolean }[] };
  canCreate: boolean;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    const res = await recordExpense({
      amount: Number(amount) || 0,
      category,
      note: note || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setAmount("");
    setNote("");
    router.refresh();
  };

  return (
    <div className="fade-up space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">المصروفات</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            مصروفات الشهر: <b className="text-red-600">{fmtMoney(data.monthTotal)}</b>
          </p>
        </div>
      </div>

      {canCreate && (
        <Card title="سجّل مصروف سريع" icon={<Icon name="expense" size={17} />}>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="المبلغ">
              <Input type="number" step="0.5" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="300" />
            </Field>
            <Field label="النوع">
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="ملاحظة (اختياري)">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="فاتورة الشهر" />
            </Field>
            <div className="flex items-end">
              <Btn className="w-full" loading={busy} onClick={submit} disabled={!(Number(amount) > 0)}>
                تسجيل
              </Btn>
            </div>
          </div>
          {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
        </Card>
      )}

      <Card title="آخر المصروفات" icon={<Icon name="timeline" size={17} />} pad={false}>
        {data.expenses.length === 0 ? (
          <Empty icon="expense" title="مفيش مصروفات" desc="أول مصروف هيظهر هنا ويتخصم من الخزنة فورًا." />
        ) : (
          <ul className="divide-y divide-slate-50">
            {data.expenses.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-5 py-3.5">
                <Badge tone={e.isToday ? "red" : "gray"}>{e.category}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-700">{e.note ?? "—"}</p>
                  <p className="text-[11px] text-slate-400">{fmtDateTime(e.at)}</p>
                </div>
                <b className="text-sm text-red-600">-{fmtMoney(e.amount)}</b>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
