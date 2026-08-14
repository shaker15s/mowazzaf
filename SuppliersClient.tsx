"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Btn, Modal, Input, Field, Icon } from "@/components/ui";
import { createSupplier } from "@/lib/engine";

export default function SuppliersClient() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    const res = await createSupplier({ name, phone: phone || undefined });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setOpen(false);
    setName("");
    setPhone("");
    router.refresh();
  };

  return (
    <>
      <Btn onClick={() => setOpen(true)}>
        <Icon name="plus" size={16} />
        مورد جديد
      </Btn>
      <Modal open={open} onClose={() => setOpen(false)} title="مورد جديد">
        <div className="space-y-3">
          <Field label="الاسم">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: شركة الجميل للبضاعة" autoFocus />
          </Field>
          <Field label="الموبايل (اختياري)">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx" dir="ltr" />
          </Field>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
          <Btn className="w-full" size="lg" loading={busy} onClick={submit} disabled={!name.trim()}>
            حفظ
          </Btn>
        </div>
      </Modal>
    </>
  );
}
