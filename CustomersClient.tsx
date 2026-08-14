"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Btn, Modal, Input, Field, Icon } from "@/components/ui";
import { createCustomer } from "@/lib/engine";

export default function CustomersClient() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    const res = await createCustomer({
      name,
      phone: phone || undefined,
      creditLimit: Number(limit) || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setOpen(false);
    setName("");
    setPhone("");
    setLimit("");
    router.refresh();
  };

  return (
    <>
      <Btn onClick={() => setOpen(true)}>
        <Icon name="plus" size={16} />
        عميل جديد
      </Btn>
      <Modal open={open} onClose={() => setOpen(false)} title="عميل جديد">
        <div className="space-y-3">
          <Field label="الاسم">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: محمد عبد العاطي" autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الموبايل (اختياري)">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx" dir="ltr" />
            </Field>
            <Field label="حد الائتمان (اختياري)" hint="أقصى دين مسموح به">
              <Input type="number" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="500" />
            </Field>
          </div>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
          <Btn className="w-full" size="lg" loading={busy} onClick={submit} disabled={!name.trim()}>
            حفظ
          </Btn>
        </div>
      </Modal>
    </>
  );
}
