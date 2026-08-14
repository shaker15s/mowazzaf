"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Btn, Input, Modal, Field, Icon, Badge } from "@/components/ui";
import { closeCashSession } from "@/lib/engine";
import { fmtMoney } from "@/lib/money";

export default function CloseDay({ expected }: { expected: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [actual, setActual] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ expected: number; actual: number; variance: number } | null>(null);

  const submit = async () => {
    setBusy(true);
    setError("");
    const res = await closeCashSession({ actual: Number(actual) || 0 });
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    setResult({ expected: res.expected, actual: res.actual, variance: res.variance });
    setBusy(false);
    router.refresh();
  };

  const variance = result ? result.variance : Number(actual || 0) - expected;

  return (
    <>
      <Btn variant="dark" onClick={() => setOpen(true)} size="lg">
        <Icon name="cash" size={18} />
        إقفال اليوم
      </Btn>

      <Modal open={open} onClose={() => { setOpen(false); setResult(null); setActual(""); }} title="إقفال اليوم 🔒">
        {!result ? (
          <div className="space-y-4">
            <p className="text-sm leading-6 text-slate-600">
              الخزنة المتوقعة بعد حساب مبيعات اليوم والمصروفات والتحصيلات:
            </p>
            <div className="rounded-2xl bg-slate-900 p-4 text-center">
              <p className="text-xs text-slate-400">المتوقع في الدرج</p>
              <p className="mt-1 text-3xl font-black text-white">{fmtMoney(expected)}</p>
            </div>
            <Field label="عدّ الفلوس الفعلية واكتبها هنا">
              <Input
                type="number"
                step="0.5"
                inputMode="decimal"
                placeholder="الموجود فعليًا"
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                autoFocus
              />
            </Field>
            {actual !== "" && Math.abs(variance) > 0.009 && (
              <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold ${variance < 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
                <Icon name="alert" size={16} />
                {variance < 0 ? `عجز ${fmtMoney(Math.abs(variance))} — راجع الفواتير والمصروفات من السجل الزمني` : `زيادة ${fmtMoney(variance)} عن المتوقع`}
              </div>
            )}
            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
            <Btn className="w-full" size="lg" loading={busy} onClick={submit} disabled={actual === ""}>
              تأكيد الإقفال
            </Btn>
          </div>
        ) : (
          <div className="space-y-4 text-center">
            <p className="text-4xl">{result.variance === 0 ? "🎯" : result.variance < 0 ? "⚠️" : "✨"}</p>
            <p className="text-lg font-black text-slate-900">
              {result.variance === 0
                ? "الخزنة مظبوطة 100%!"
                : result.variance < 0
                  ? `تم الإقفال — فيه عجز ${fmtMoney(Math.abs(result.variance))}`
                  : `تم الإقفال — فيه زيادة ${fmtMoney(result.variance)}`}
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-[11px] text-slate-500">متوقع</p>
                <p className="text-sm font-black text-slate-800">{fmtMoney(result.expected)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-[11px] text-slate-500">فعلي</p>
                <p className="text-sm font-black text-slate-800">{fmtMoney(result.actual)}</p>
              </div>
              <div className={`rounded-xl p-3 ${result.variance === 0 ? "bg-emerald-50" : result.variance < 0 ? "bg-red-50" : "bg-amber-50"}`}>
                <p className="text-[11px] text-slate-500">الفرق</p>
                <p className={`text-sm font-black ${result.variance === 0 ? "text-emerald-700" : result.variance < 0 ? "text-red-600" : "text-amber-600"}`}>
                  {fmtMoney(result.variance)}
                </p>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              كل حاجة اتسجلت في السجل الزمني — تقدر تراجعها في أي وقت.
            </p>
            <Btn variant="outline" className="w-full" onClick={() => setOpen(false)}>
              تمام
            </Btn>
          </div>
        )}
      </Modal>
    </>
  );
}
