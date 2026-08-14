"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Btn, Modal, Input, Field, Icon } from "@/components/ui";
import { recordSupplierPayment } from "@/lib/engine";
import { fmtMoney } from "@/lib/money";

export default function SupplierPayment({
  supplierId,
  supplierName,
  balance,
}: {
  supplierId: number;
  supplierName: string;
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
    const res = await recordSupplierPayment({
      supplierId,
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
      <Btn onClick={() => setOpen(true)}>
        <Icon name="coins" size={17} />
        ادفع لـ {supplierName}
      </Btn>
      <Modal open={open} onClose={() => setOpen(false)} title={`دفع إلى ${supplierName}`}>
        <div className="space-y-3">
          <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
            عليه حالياً: <b className="text-red-600">{balance > 0 ? fmtMoney(balance) : "خالص"}</b>
          </p>
          <Field label="المبلغ">
            <Input
              type="number"
              step="0.5"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1000"
              autoFocus
            />
          </Field>
          <Field label="ملاحظة (اختياري)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="دفعة مقدم" />
          </Field>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
          <Btn className="w-full" size="lg" loading={busy} onClick={submit} disabled={!(Number(amount) > 0)}>
            تسجيل الدفع — يتخصم من الخزنة
          </Btn>
        </div>
      </Modal>
    </>
  );
}
