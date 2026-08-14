"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge, Icon, Btn, Modal, Input, Field, Select, Empty } from "@/components/ui";
import { createEmployee, updateEmployeeRole, removeEmployee } from "@/lib/engine";
import { ROLE_LABELS } from "@/lib/roles";
import { fmtDateShort } from "@/lib/money";

type Row = { id: number; userId: number; name: string; email: string; role: "owner" | "manager" | "cashier" | "inventory"; joinedAt: Date };

const ROLE_TONES: Record<string, "green" | "blue" | "amber" | "gray"> = {
  owner: "green",
  manager: "blue",
  cashier: "amber",
  inventory: "gray",
};

export default function EmployeesClient({
  employees,
  currentUserId,
}: {
  employees: Row[];
  currentUserId: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"manager" | "cashier" | "inventory">("cashier");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    const res = await createEmployee({ name, email, password, role });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setOpen(false);
    setName("");
    setEmail("");
    setPassword("");
    router.refresh();
  };

  const changeRole = async (membershipId: number, newRole: Row["role"]) => {
    const res = await updateEmployeeRole(membershipId, newRole);
    if (res.ok) router.refresh();
  };

  const remove = async (membershipId: number) => {
    if (!confirm("هل أنت متأكد من إزالة هذا الموظف من النشاط؟")) return;
    const res = await removeEmployee(membershipId);
    if (!res.ok) alert(res.error);
    else router.refresh();
  };

  return (
    <div className="fade-up space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">الموظفون</h1>
          <p className="mt-0.5 text-sm text-slate-500">كل دور ليه صلاحيات محددة — والمساعد يحترم نفس الصلاحيات</p>
        </div>
        <Btn onClick={() => { setOpen(true); setError(""); }}>
          <Icon name="plus" size={16} />
          موظف جديد
        </Btn>
      </div>

      <Card pad={false}>
        {employees.length === 0 ? (
          <Empty icon="employees" title="مفيش موظفين" />
        ) : (
          <ul className="divide-y divide-slate-50">
            {employees.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-black text-slate-500">
                  {e.name.charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-slate-800">
                    {e.name}
                    {e.userId === currentUserId && <span className="mr-2 text-[10px] text-slate-400">(أنت)</span>}
                  </p>
                  <p className="text-[11px] text-slate-400" dir="ltr">{e.email}</p>
                </div>
                <p className="text-[11px] text-slate-400">انضم {fmtDateShort(e.joinedAt)}</p>
                {e.role === "owner" ? (
                  <Badge tone="green">{ROLE_LABELS.owner}</Badge>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Select
                      value={e.role}
                      onChange={(ev) => changeRole(e.id, ev.target.value as Row["role"])}
                      className="w-32 py-1.5 text-xs"
                    >
                      <option value="manager">مدير</option>
                      <option value="cashier">كاشير</option>
                      <option value="inventory">أمين مخزن</option>
                    </Select>
                    <button
                      onClick={() => remove(e.id)}
                      className="rounded-lg p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                      title="إزالة"
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="موظف جديد">
        <div className="space-y-3">
          <Field label="الاسم">
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="البريد الإلكتروني">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" placeholder="name@mail.com" />
            </Field>
            <Field label="كلمة المرور">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" placeholder="••••" />
            </Field>
          </div>
          <Field label="الدور">
            <Select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              <option value="manager">مدير — بيع وإدارة ومصروفات وخزنة وتقارير (بدون موظفين)</option>
              <option value="cashier">كاشير — بيع وعملاء فقط (مش هيشوف الربح ولا يلغي فواتير)</option>
              <option value="inventory">أمين مخزن — منتجات وشراء وموردون</option>
            </Select>
          </Field>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
          <Btn className="w-full" size="lg" loading={busy} onClick={submit} disabled={!name.trim() || !email.trim() || !password}>
            إضافة الموظف
          </Btn>
        </div>
      </Modal>
    </div>
  );
}
