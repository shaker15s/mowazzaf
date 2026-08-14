"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge, Icon, Btn, Modal, Input, Field, Empty } from "@/components/ui";
import { openCashSession, closeCashSession, recordCashAdjustment, cashIn, cashOut } from "@/lib/engine";
import { fmtMoney, fmtTime, fmtDateTime } from "@/lib/money";
import CloseDay from "@/components/CloseDay";

type Data = {
  session: { id: number; opening: number; openedAt: Date; expected: number } | null;
  lastClosed: {
    id: number;
    opening: number;
    expected: number;
    actual: number;
    variance: number;
    closeNote: string | null;
    closedAt: Date | null;
  } | null;
  expected: number;
  breakdown: { type: string; label: string; amount: number }[];
  movements: { id: number; type: string; label: string; amount: number; note: string | null; at: Date }[];
};

export default function CashClient({ data, canManage }: { data: Data; canManage: boolean }) {
  const router = useRouter();
  const [openModal, setOpenModal] = useState(false);
  const [opening, setOpening] = useState("");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [inOutOpen, setInOutOpen] = useState<"in" | "out" | null>(null);
  const [inOutAmount, setInOutAmount] = useState("");
  const [inOutNote, setInOutNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const doOpen = async () => {
    setBusy(true);
    setError("");
    const res = await openCashSession({ opening: Number(opening) || 0 });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setOpenModal(false);
    setOpening("");
    router.refresh();
  };

  const doAdjust = async () => {
    setBusy(true);
    setError("");
    const res = await recordCashAdjustment({ amount: Number(adjustAmount) || 0, note: adjustNote || undefined });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setAdjustOpen(false);
    setAdjustAmount("");
    setAdjustNote("");
    router.refresh();
  };

  const doInOut = async () => {
    if (!inOutOpen) return;
    setBusy(true);
    setError("");
    const res =
      inOutOpen === "in"
        ? await cashIn({ amount: Number(inOutAmount) || 0, note: inOutNote || undefined })
        : await cashOut({ amount: Number(inOutAmount) || 0, note: inOutNote || undefined });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setInOutOpen(null);
    setInOutAmount("");
    setInOutNote("");
    router.refresh();
  };

  return (
    <div className="fade-up space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">الخزنة</h1>
          <p className="mt-0.5 text-sm text-slate-500">مبنية على دفتر حركات — كل جنيه ليه مصدر</p>
        </div>
        {canManage && (
          data.session ? (
            <CloseDay expected={data.session.expected} />
          ) : (
            <Btn onClick={() => { setOpenModal(true); setError(""); }}>
              <Icon name="plus" size={16} />
              افتح الخزنة
            </Btn>
          )
        )}
      </div>

      {/* حالة الجلسة */}
      {data.session ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-slate-900 p-5 text-white shadow-sm">
            <p className="text-xs text-slate-400">الرصيد المتوقع الآن</p>
            <p className="mt-1 text-3xl font-black">{fmtMoney(data.session.expected)}</p>
            <p className="mt-1 text-[11px] text-slate-400">فتحها {fmtTime(data.session.openedAt)} بمبلغ {fmtMoney(data.session.opening)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:col-span-2">
            <p className="mb-3 text-xs font-bold text-slate-500">من أين جاء الرصيد؟</p>
            <div className="flex flex-wrap gap-2">
              {data.breakdown.length === 0 && <p className="text-xs text-slate-400">مفيش حركات بعد الفتح</p>}
              {data.breakdown.map((b) => (
                <Badge key={b.type} tone={b.amount >= 0 ? "green" : "red"}>
                  {b.label}: {b.amount >= 0 ? "+" : ""}{fmtMoney(b.amount)}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50 p-6 text-center">
          <p className="text-lg font-black text-amber-800">الخزنة مقفولة 🔒</p>
          <p className="mt-1 text-sm text-amber-700">
            افتح الخزنة بالمبلغ اللي هتبدأ بيه اليوم — كل البيع والمصروفات بعدها هتتسجل تلقائيًا.
          </p>
        </div>
      )}

      {/* آخر إقفال */}
      {data.lastClosed && (
        <Card title="آخر إقفال يوم" icon={<Icon name="check" size={17} />}>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[11px] text-slate-500">المتوقع</p>
              <p className="text-sm font-black">{fmtMoney(data.lastClosed.expected)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[11px] text-slate-500">الفعلي</p>
              <p className="text-sm font-black">{fmtMoney(data.lastClosed.actual)}</p>
            </div>
            <div className={`rounded-xl p-3 ${Math.abs(data.lastClosed.variance) < 0.009 ? "bg-emerald-50" : data.lastClosed.variance < 0 ? "bg-red-50" : "bg-amber-50"}`}>
              <p className="text-[11px] text-slate-500">الفرق</p>
              <p className={`text-sm font-black ${Math.abs(data.lastClosed.variance) < 0.009 ? "text-emerald-700" : data.lastClosed.variance < 0 ? "text-red-600" : "text-amber-600"}`}>
                {fmtMoney(data.lastClosed.variance)}
              </p>
            </div>
          </div>
          {data.lastClosed.closeNote && (
            <p className="mt-2 text-center text-[11px] text-slate-400">{data.lastClosed.closeNote}</p>
          )}
        </Card>
      )}

      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Btn variant="outline" size="sm" onClick={() => { setInOutOpen("in"); setError(""); }}>
            <Icon name="plus" size={14} /> إيراد آخر
          </Btn>
          <Btn variant="outline" size="sm" onClick={() => { setInOutOpen("out"); setError(""); }}>
            <Icon name="minus" size={14} /> سحب من الخزنة
          </Btn>
          <Btn variant="outline" size="sm" onClick={() => { setAdjustOpen(true); setError(""); }}>
            <Icon name="edit" size={14} /> تسوية خزنة
          </Btn>
        </div>
      )}

      {/* دفتر الحركات */}
      <Card title="دفتر حركات الخزنة (اليوم)" icon={<Icon name="timeline" size={17} />} pad={false}>
        {data.movements.length === 0 ? (
          <Empty icon="cash" title="مفيش حركات" desc="افتح الخزنة وابدأ البيع." />
        ) : (
          <ul className="divide-y divide-slate-50">
            {data.movements.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-5 py-3">
                <Badge tone={m.amount >= 0 ? "green" : "red"}>{m.label}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-600">{m.note ?? "—"}</p>
                  <p className="text-[11px] text-slate-400">{fmtDateTime(m.at)}</p>
                </div>
                <b className={`text-sm ${m.amount >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                  {m.amount >= 0 ? "+" : ""}{fmtMoney(m.amount)}
                </b>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* فتح */}
      <Modal open={openModal} onClose={() => setOpenModal(false)} title="فتح الخزنة 🔓">
        <div className="space-y-3">
          <Field label="مبلغ الفتح (الفلوس اللي هتبدأ بيها اليوم)">
            <Input type="number" step="0.5" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="5000" autoFocus />
          </Field>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
          <Btn className="w-full" size="lg" loading={busy} onClick={doOpen}>
            فتح
          </Btn>
        </div>
      </Modal>

      {/* تسوية */}
      <Modal open={adjustOpen} onClose={() => setAdjustOpen(false)} title="تسوية خزنة">
        <div className="space-y-3">
          <p className="text-xs leading-5 text-slate-500">
            رقم موجب = الفلوس تزود عن المتوقع، سالب = عجز. التسوية بتتحفظ كحركة بملاحظتها — مش هيتشطب حاجة.
          </p>
          <Field label="مبلغ التسوية (موجب أو سالب)">
            <Input type="number" step="0.5" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} placeholder="-30" autoFocus />
          </Field>
          <Field label="ملاحظة">
            <Input value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} placeholder="فرق نثريات" />
          </Field>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
          <Btn className="w-full" size="lg" loading={busy} onClick={doAdjust} disabled={!adjustAmount}>
            حفظ التسوية
          </Btn>
        </div>
      </Modal>

      {/* إيراد/سحب */}
      <Modal open={inOutOpen !== null} onClose={() => setInOutOpen(null)} title={inOutOpen === "in" ? "إيراد آخر" : "سحب من الخزنة"}>
        <div className="space-y-3">
          <Field label={inOutOpen === "in" ? "المبلغ الداخل" : "المبلغ المسحوب"}>
            <Input type="number" step="0.5" value={inOutAmount} onChange={(e) => setInOutAmount(e.target.value)} autoFocus />
          </Field>
          <Field label="ملاحظة">
            <Input value={inOutNote} onChange={(e) => setInOutNote(e.target.value)} placeholder={inOutOpen === "in" ? "مبيعات خدمة" : "سحب شخصي"} />
          </Field>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
          <Btn className="w-full" size="lg" loading={busy} onClick={doInOut} disabled={!(Number(inOutAmount) > 0)}>
            حفظ
          </Btn>
        </div>
      </Modal>
    </div>
  );
}
