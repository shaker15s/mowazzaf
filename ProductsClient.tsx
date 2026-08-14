"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge, Icon, Btn, Modal, Input, Field, Select, Empty } from "@/components/ui";
import { createProduct, updateProduct, adjustStock } from "@/lib/engine";
import { fmtMoney, fmtQty } from "@/lib/money";

type ProductRow = {
  id: number;
  name: string;
  categoryId: number | null;
  categoryName: string;
  unitId: number;
  unitSymbol: string;
  salePrice: number;
  costPrice: number;
  barcode: string | null;
  isWeighted: boolean;
  reorderPoint: number;
  stock: number;
  parentId: number | null;
};

type Data = {
  products: ProductRow[];
  categories: { id: number; name: string }[];
  units: { id: number; name: string; symbol: string }[];
};

export default function ProductsClient({ data, canEdit }: { data: Data; canEdit: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ProductRow | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<ProductRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /* نموذج الإضافة */
  const [fName, setFName] = useState("");
  const [fPrice, setFPrice] = useState("");
  const [fCost, setFCost] = useState("");
  const [fCat, setFCat] = useState(0);
  const [fUnit, setFUnit] = useState(0);
  const [fWeighted, setFWeighted] = useState(false);
  const [fReorder, setFReorder] = useState("");
  const [fBarcode, setFBarcode] = useState("");
  const [fOpening, setFOpening] = useState("");

  /* نموذج التعديل */
  const [eName, setEName] = useState("");
  const [ePrice, setEPrice] = useState("");
  const [eCost, setECost] = useState("");
  const [eReorder, setEReorder] = useState("");
  const [eBarcode, setEBarcode] = useState("");

  /* الجرد */
  const [aQty, setAQty] = useState("");
  const [aNote, setANote] = useState("");

  const filtered = useMemo(
    () => data.products.filter((p) => p.name.includes(query.trim()) || (p.barcode ?? "").includes(query.trim())),
    [data.products, query],
  );

  const resetAdd = () => {
    setFName(""); setFPrice(""); setFCost(""); setFCat(0); setFUnit(0);
    setFWeighted(false); setFReorder(""); setFBarcode(""); setFOpening("");
  };

  const submitAdd = async () => {
    setBusy(true);
    setError("");
    const res = await createProduct({
      name: fName,
      salePrice: Number(fPrice) || 0,
      costPrice: fCost ? Number(fCost) : undefined,
      unitId: fUnit || data.units[0]?.id || 1,
      categoryId: fCat || undefined,
      isWeighted: fWeighted,
      barcode: fBarcode || undefined,
      reorderPoint: Number(fReorder) || 0,
      openingQty: Number(fOpening) || 0,
    });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setAddOpen(false);
    resetAdd();
    router.refresh();
  };

  const submitEdit = async () => {
    if (!editTarget) return;
    setBusy(true);
    setError("");
    const res = await updateProduct({
      id: editTarget.id,
      name: eName,
      salePrice: Number(ePrice) || 0,
      costPrice: eCost ? Number(eCost) : null,
      reorderPoint: Number(eReorder) || 0,
      barcode: eBarcode || null,
    });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setEditTarget(null);
    router.refresh();
  };

  const submitAdjust = async () => {
    if (!adjustTarget) return;
    setBusy(true);
    setError("");
    const res = await adjustStock({
      productId: adjustTarget.id,
      newQty: Number(aQty) || 0,
      note: aNote || "تسوية جرد",
    });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setAdjustTarget(null);
    setAQty("");
    setANote("");
    router.refresh();
  };

  return (
    <div className="fade-up space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">المنتجات</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {data.products.length} منتج — الرصيد محسوب من حركات المخزون مش من رقم متغير
          </p>
        </div>
        {canEdit && (
          <Btn onClick={() => { resetAdd(); setError(""); setAddOpen(true); }}>
            <Icon name="plus" size={16} />
            منتج جديد
          </Btn>
        )}
      </div>

      <div className="relative">
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400">
          <Icon name="search" size={17} />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث بالاسم أو الباركود…"
          className="w-full rounded-2xl border border-slate-300 bg-white py-3 pl-4 pr-11 text-sm font-bold outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
        />
      </div>

      <Card pad={false}>
        {filtered.length === 0 ? (
          <Empty icon="products" title="مفيش منتجات" desc={canEdit ? "أضف منتج أو ادخل نقطة البيع وهتقدر تنشئ منتج أثناء البيع." : "اطلب من المدير إضافة المنتجات."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-right text-[11px] text-slate-400">
                  <th className="px-4 py-3 font-bold">المنتج</th>
                  <th className="px-4 py-3 font-bold">الفئة</th>
                  <th className="px-4 py-3 font-bold">سعر البيع</th>
                  <th className="px-4 py-3 font-bold">التكلفة</th>
                  <th className="px-4 py-3 font-bold">المخزون</th>
                  <th className="px-4 py-3 font-bold">الحالة</th>
                  {canEdit && <th className="px-4 py-3 font-bold">إجراءات</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((p) => {
                  const low = p.stock < 0 || (p.reorderPoint > 0 && p.stock <= p.reorderPoint);
                  return (
                    <tr key={p.id} className="transition hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <p className="font-black text-slate-800">
                          {p.name}
                          {p.isWeighted && <Badge tone="blue" className="mr-1.5">وزن</Badge>}
                        </p>
                        {p.barcode && <p className="text-[10px] text-slate-400" dir="ltr">{p.barcode}</p>}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{p.categoryName || "—"}</td>
                      <td className="px-4 py-3 font-bold text-emerald-700">{fmtMoney(p.salePrice)}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{p.costPrice > 0 ? fmtMoney(p.costPrice) : "—"}</td>
                      <td className="px-4 py-3">
                        <b className={p.stock < 0 ? "text-red-600" : "text-slate-800"}>
                          {fmtQty(p.stock)} {p.unitSymbol}
                        </b>
                      </td>
                      <td className="px-4 py-3">
                        {p.stock < 0 ? (
                          <Badge tone="red">سالب — راجع الشراء</Badge>
                        ) : low ? (
                          <Badge tone="amber">قرب يخلص</Badge>
                        ) : p.stock === 0 ? (
                          <Badge tone="gray">نافد</Badge>
                        ) : (
                          <Badge tone="green">متوفر</Badge>
                        )}
                      </td>
                      {canEdit && (
                        <td className="px-4 py-3">
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => {
                                setEditTarget(p);
                                setEName(p.name); setEPrice(String(p.salePrice));
                                setECost(p.costPrice ? String(p.costPrice) : ""); setEReorder(String(p.reorderPoint));
                                setEBarcode(p.barcode ?? "");
                                setError("");
                              }}
                              className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100"
                              title="تعديل"
                            >
                              <Icon name="edit" size={16} />
                            </button>
                            <button
                              onClick={() => { setAdjustTarget(p); setAQty(String(p.stock)); setANote(""); setError(""); }}
                              className="rounded-lg p-1.5 text-amber-600 transition hover:bg-amber-50"
                              title="جرد / تسوية"
                            >
                              <Icon name="weight" size={16} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* إضافة */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="منتج جديد">
        <div className="space-y-3">
          <Field label="اسم المنتج">
            <Input value={fName} onChange={(e) => setFName(e.target.value)} autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="سعر البيع (ج.م)">
              <Input type="number" step="0.5" value={fPrice} onChange={(e) => setFPrice(e.target.value)} placeholder="10" />
            </Field>
            <Field label="سعر الشراء (اختياري)">
              <Input type="number" step="0.5" value={fCost} onChange={(e) => setFCost(e.target.value)} placeholder="7" />
            </Field>
            <Field label="الفئة">
              <Select value={fCat || ""} onChange={(e) => setFCat(Number(e.target.value) || 0)}>
                <option value="">بدون فئة</option>
                {data.categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="الوحدة">
              <Select value={fUnit || ""} onChange={(e) => setFUnit(Number(e.target.value) || 0)}>
                {data.units.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="حد إعادة الطلب (اختياري)">
              <Input type="number" value={fReorder} onChange={(e) => setFReorder(e.target.value)} placeholder="10" />
            </Field>
            <Field label="الباركود (اختياري)">
              <Input value={fBarcode} onChange={(e) => setFBarcode(e.target.value)} placeholder="6223..." dir="ltr" />
            </Field>
            <Field label="رصيد افتتاحي (اختياري)">
              <Input type="number" value={fOpening} onChange={(e) => setFOpening(e.target.value)} placeholder="20" />
            </Field>
            <Field label="يباع بالوزن؟">
              <button
                type="button"
                onClick={() => setFWeighted((v) => !v)}
                className={`mt-1 flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-sm font-bold ${fWeighted ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-300 text-slate-500"}`}
              >
                كيلو / جرام
                <Icon name={fWeighted ? "check" : "x"} size={15} />
              </button>
            </Field>
          </div>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
          <Btn className="w-full" size="lg" loading={busy} onClick={submitAdd} disabled={!fName.trim()}>
            حفظ المنتج
          </Btn>
        </div>
      </Modal>

      {/* تعديل */}
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title={`تعديل: ${editTarget?.name ?? ""}`}>
        <div className="space-y-3">
          <Field label="الاسم">
            <Input value={eName} onChange={(e) => setEName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="سعر البيع">
              <Input type="number" step="0.5" value={ePrice} onChange={(e) => setEPrice(e.target.value)} />
            </Field>
            <Field label="سعر الشراء">
              <Input type="number" step="0.5" value={eCost} onChange={(e) => setECost(e.target.value)} />
            </Field>
            <Field label="حد إعادة الطلب">
              <Input type="number" value={eReorder} onChange={(e) => setEReorder(e.target.value)} />
            </Field>
            <Field label="الباركود">
              <Input value={eBarcode} onChange={(e) => setEBarcode(e.target.value)} dir="ltr" />
            </Field>
          </div>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
          <Btn className="w-full" size="lg" loading={busy} onClick={submitEdit}>
            حفظ التعديل
          </Btn>
        </div>
      </Modal>

      {/* جرد */}
      <Modal open={!!adjustTarget} onClose={() => setAdjustTarget(null)} title={`جرد: ${adjustTarget?.name ?? ""}`}>
        <div className="space-y-3">
          <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
            الرصيد الحالي: <b>{fmtQty(adjustTarget?.stock ?? 0)}</b> — اكتب الكمية الفعلية بعد العد،
            والفرق هيتسجل كحركة تسوية (مش هيتمسح التاريخ).
          </p>
          <Field label="الكمية الفعلية">
            <Input type="number" step="0.25" value={aQty} onChange={(e) => setAQty(e.target.value)} autoFocus />
          </Field>
          <Field label="ملاحظة (اختياري)">
            <Input value={aNote} onChange={(e) => setANote(e.target.value)} placeholder="جرد نهاية الشهر" />
          </Field>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
          <Btn className="w-full" size="lg" loading={busy} onClick={submitAdjust}>
            حفظ التسوية
          </Btn>
        </div>
      </Modal>
    </div>
  );
}
