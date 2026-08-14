"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Btn, Modal, Input, Field, Icon } from "@/components/ui";
import { recordCustomerPayment } from "@/lib/engine";
import { fmtMoney } from "@/lib/money";

export default function CustomerPayment({
  customerId,
  customerName,
  balance,
}: {
  customerId: number;
  customerName: string;
  balance: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    const res = await recordCustomerPayment({
      customerId,
      amount: Number(amount) || 0,
      note: note || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setOpen(false);
    setAmount("");
    setNote("");
    router.refresh();
  };

  return (
    <>
      <Btn variant="success" onClick={() => setOpen(true)}>
        <Icon name="coins" size={17} />
        قبض من {customerName}
      </Btn>
      <Modal open={open} onClose={() => setOpen(false)} title={`قبض من ${customerName}`}>
        <div className="space-y-3">
          <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
            رصيده الحالي: <b className={balance > 0 ? "text-amber-600" : "text-slate-800"}>{balance > 0 ? `عليه ${fmtMoney(balance)}` : "خالص"}</b>
          </p>
          <Field label="المبلغ المدفوع">
            <Input
              type="number"
              step="0.5"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="500"
              autoFocus
            />
          </Field>
          <Field label="ملاحظة (اختياري)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="دفعة من الحساب" />
          </Field>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
          <Btn className="w-full" size="lg" loading={busy} onClick={submit} disabled={!(Number(amount) > 0)}>
            تسجيل القبض — تروح للخزنة مباشرة
          </Btn>
        </div>
      </Modal>
    </>
  );
}
