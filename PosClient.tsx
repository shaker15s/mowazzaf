"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Btn, Icon, Input, Select, Modal, Field, Badge, Spinner } from "@/components/ui";
import { createSale, createProduct } from "@/lib/engine";
import { fmtMoney, fmtQty, fmtDateShort, fmtTime, METHOD_LABELS } from "@/lib/money";

type Product = {
  id: number;
  name: string;
  parentName?: string;
  price: number;
  isWeighted: boolean;
  barcode: string | null;
  categoryId: number | null;
  unitId: number;
  stock: number;
};

type Customer = { id: number; name: string; balance: number; creditLimit: number };

type CartItem = {
  key: string;
  productId: number;
  name: string;
  qty: number;
  unitPrice: number;
  isWeighted: boolean;
};

type SalePayload = {
  kind: "detailed" | "quick";
  items: { productId?: number; qty: number }[];
  quickTotal?: number;
  discount?: number;
  method: "cash" | "card" | "wallet" | "credit";
  paidAmount?: number;
  customerId?: number;
  clientRef: string;
};

const QUEUE_KEY = "mos_pos_queue";
const CART_KEY = "mos_pos_cart";

export default function PosClient({
  businessId,
  role,
  products,
  categories,
  customers,
  preselectCustomerId,
  startQuick,
}: {
  businessId: number;
  role: string;
  products: Product[];
  categories: { id: number; name: string; emoji: string | null }[];
  customers: Customer[];
  preselectCustomerId?: number;
  startQuick?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"items" | "quick">(startQuick ? "quick" : "items");
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<number | "all">("all");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [customerId, setCustomerId] = useState<number>(preselectCustomerId ?? 0);
  const [method, setMethod] = useState<"cash" | "card" | "wallet" | "credit">("cash");
  const [paidNow, setPaidNow] = useState(0);
  const [quickTotal, setQuickTotal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Record<string, unknown> | null>(null);
  const [online, setOnline] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newWeighted, setNewWeighted] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [localNote, setLocalNote] = useState("");
  const barcodeRef = useRef<HTMLInputElement>(null);

  /* ------------------------- حفظ واستعادة السلة ------------------------- */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CART_KEY + businessId);
      if (saved) setCart(JSON.parse(saved));
    } catch {}
  }, [businessId]);

  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY + businessId, JSON.stringify(cart));
    } catch {}
  }, [cart, businessId]);

  useEffect(() => {
    try {
      const q = JSON.parse(localStorage.getItem(QUEUE_KEY + businessId) || "[]");
      setQueueCount(Array.isArray(q) ? q.length : 0);
    } catch {}
  }, [businessId]);

  /* ------------------------- الاتصال وقائمة الانتظار ------------------------- */
  const flushQueue = useCallback(async () => {
    let queue: SalePayload[] = [];
    try {
      queue = JSON.parse(localStorage.getItem(QUEUE_KEY + businessId) || "[]");
    } catch {}
    if (!queue.length) return;
    for (const payload of [...queue]) {
      const res = await createSale(payload);
      if (res.ok) {
        queue = queue.filter((q) => q.clientRef !== payload.clientRef);
        localStorage.setItem(QUEUE_KEY + businessId, JSON.stringify(queue));
        setQueueCount(queue.length);
        router.refresh();
      } else {
        break;
      }
    }
  }, [businessId, router]);

  useEffect(() => {
    const go = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) flushQueue();
    };
    window.addEventListener("online", go);
    window.addEventListener("offline", go);
    return () => {
      window.removeEventListener("online", go);
      window.removeEventListener("offline", go);
    };
  }, [flushQueue]);

  /* ------------------------- منطق السلة ------------------------- */
  const addProduct = (p: Product) => {
    setError("");
    setCart((c) => {
      const existing = c.find((i) => i.productId === p.id && !p.isWeighted);
      if (existing) {
        return c.map((i) => (i.key === existing.key ? { ...i, qty: i.qty + 1 } : i));
      }
      return [
        ...c,
        {
          key: `${p.id}-${Date.now()}`,
          productId: p.id,
          name: p.name,
          qty: p.isWeighted ? 0.25 : 1,
          unitPrice: p.price,
          isWeighted: p.isWeighted,
        },
      ];
    });
    barcodeRef.current?.focus();
  };

  const setQty = (key: string, delta: number) => {
    setCart((c) =>
      c
        .map((i) => {
          if (i.key !== key) return i;
          const step = i.isWeighted ? 0.25 : 1;
          const qty = Math.max(i.isWeighted ? 0.25 : 1, Math.round((i.qty + delta * step) * 1000) / 1000);
          return { ...i, qty };
        })
        .filter((i) => i.qty > 0),
    );
  };

  const removeItem = (key: string) => setCart((c) => c.filter((i) => i.key !== key));

  const itemsTotal = useMemo(() => cart.reduce((s, i) => s + i.qty * i.unitPrice, 0), [cart]);
  const total = Math.max(0, itemsTotal - discount);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) {
      return activeCat === "all" ? products.slice(0, 48) : products.filter((p) => p.categoryId === activeCat);
    }
    const byBarcode = products.filter((p) => p.barcode && p.barcode.includes(q));
    const byName = products.filter((p) => p.name.includes(q));
    return [...byBarcode, ...byName].slice(0, 12);
  }, [query, activeCat, products]);

  /* الباركود/البحث: Enter يضيف أول نتيجة */
  const onSearchEnter = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    const exact = products.find((p) => p.barcode && p.barcode === q);
    if (exact) {
      addProduct(exact);
      setQuery("");
      return;
    }
    if (filtered.length === 1) {
      addProduct(filtered[0]);
      setQuery("");
      return;
    }
    const named = products.find((p) => p.name === q);
    if (named) {
      addProduct(named);
      setQuery("");
    }
  };

  /* ------------------------- إنشاء منتج أثناء البيع ------------------------- */
  const submitNewProduct = async () => {
    const price = Number(newPrice);
    if (!newName.trim() || !(price > 0)) {
      setError("اكتب اسم المنتج وسعره.");
      return;
    }
    setBusy(true);
    setError("");
    const res = await createProduct({
      name: newName.trim(),
      salePrice: price,
      unitId: products[0]?.unitId ?? 1,
      isWeighted: newWeighted,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setCreateOpen(false);
    setNewName("");
    setNewPrice("");
    setNewWeighted(false);
    addProduct({ id: res.product.id, name: res.product.name, parentName: undefined, price: res.product.salePrice, isWeighted: newWeighted, barcode: null, categoryId: null, unitId: products[0]?.unitId ?? 1, stock: 0 });
  };

  /* ------------------------- إتمام البيع ------------------------- */
  const complete = async () => {
    setBusy(true);
    setError("");
    setLocalNote("");
    const payload: SalePayload =
      mode === "quick"
        ? {
            kind: "quick",
            items: [],
            quickTotal: Number(quickTotal) || 0,
            method,
            paidAmount: method === "credit" ? paidNow : undefined,
            customerId: method === "credit" && customerId ? customerId : undefined,
            clientRef: crypto.randomUUID(),
          }
        : {
            kind: "detailed",
            items: cart.map((i) => ({ productId: i.productId, qty: i.qty })),
            discount,
            method,
            paidAmount: method === "credit" ? paidNow : undefined,
            customerId: method === "credit" && customerId ? customerId : undefined,
            clientRef: crypto.randomUUID(),
          };

    if (mode === "quick" && !((Number(quickTotal) || 0) > 0)) {
      setError("اكتب مبلغ البيع.");
      setBusy(false);
      return;
    }
    if (mode === "items" && cart.length === 0) {
      setError("السلة فاضية — اختار منتجات أو استخدم البيع السريع.");
      setBusy(false);
      return;
    }
    if (method === "credit" && !customerId) {
      setError("البيع الآجل لازم يكون عليه اسم عميل.");
      setBusy(false);
      return;
    }

    if (!navigator.onLine) {
      // Offline-first: حفظ محلي + إرسال لاحق مع idempotency
      let queue: SalePayload[] = [];
      try {
        queue = JSON.parse(localStorage.getItem(QUEUE_KEY + businessId) || "[]");
      } catch {}
      queue.push(payload);
      localStorage.setItem(QUEUE_KEY + businessId, JSON.stringify(queue));
      setQueueCount(queue.length);
      setCart([]);
      setDiscount(0);
      setQuickTotal("");
      setBusy(false);
      setLocalNote("تم حفظ الفاتورة على الجهاز ✅ هتتسجل على السيرفر أول ما النت يرجع (لن تتكرر).");
      return;
    }

    const res = await createSale(payload);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setReceipt(res.sale);
    setCart([]);
    setDiscount(0);
    setQuickTotal("");
    router.refresh();
  };

  const startNew = () => {
    setReceipt(null);
    setCustomerId(0);
    setMethod("cash");
    setPaidNow(0);
    setQuery("");
    barcodeRef.current?.focus();
  };

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const showStock = role !== "cashier";

  /* ------------------------- الإيصال ------------------------- */
  const receiptItems = (receipt?.items as { name: string; qty: number; unitPrice: number; total: number }[]) ?? [];

  return (
    <div className="fade-up space-y-4">
      {/* حالة الاتصال */}
      {!online && (
        <div className="flex items-center gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
          <Icon name="wifi_off" size={18} />
          الإنترنت مقطوع — البيع مستمر عادي، والفاتورة هتتسجل أول ما يرجعل الاتصال.
        </div>
      )}
      {queueCount > 0 && online && (
        <div className="flex items-center gap-2 rounded-2xl bg-sky-50 px-4 py-3 text-sm font-bold text-sky-800">
          <Spinner size={15} />
          جاري مزامنة {queueCount} فاتورة محفوظة…
        </div>
      )}
      {localNote && (
        <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
          <Icon name="check" size={16} />
          {localNote}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        {/* ------------------------- المنتجات ------------------------- */}
        <div className="space-y-3 lg:col-span-3">
          <div className="flex gap-2">
            <Btn variant={mode === "items" ? "dark" : "outline"} onClick={() => setMode("items")} className="flex-1">
              <Icon name="products" size={16} />
              بيع بالمنتجات
            </Btn>
            <Btn variant={mode === "quick" ? "dark" : "outline"} onClick={() => setMode("quick")} className="flex-1">
              <Icon name="wallet2" size={16} />
              بيع سريع
            </Btn>
          </div>

          {mode === "items" ? (
            <>
              <div className="relative">
                <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <Icon name="search" size={18} />
                </span>
                <input
                  ref={barcodeRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onSearchEnter}
                  placeholder="امسح الباركود أو اكتب اسم الصنف…"
                  className="w-full rounded-2xl border border-slate-300 bg-white py-3.5 pl-4 pr-11 text-base font-bold outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
                  autoFocus
                />
              </div>

              {query.trim() && filtered.length === 0 && (
                <button
                  onClick={() => {
                    setNewName(query.trim());
                    setCreateOpen(true);
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50/50 px-4 py-3 text-right transition hover:bg-emerald-50"
                >
                  <Icon name="plus" size={18} className="text-emerald-700" />
                  <span className="text-sm font-black text-emerald-800">
                    «{query.trim()}» مش موجود — ضيفه الآن واستمر في البيع
                  </span>
                </button>
              )}

              <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
                <button
                  onClick={() => setActiveCat("all")}
                  className={`shrink-0 rounded-xl px-4 py-2 text-sm font-bold transition ${activeCat === "all" ? "bg-slate-900 text-white" : "bg-white text-slate-600 border border-slate-200"}`}
                >
                  الكل
                </button>
                {categories.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setActiveCat(c.id)}
                    className={`shrink-0 rounded-xl px-4 py-2 text-sm font-bold transition ${activeCat === c.id ? "bg-slate-900 text-white" : "bg-white text-slate-600 border border-slate-200"}`}
                  >
                    {c.emoji} {c.name}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
                {filtered.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => addProduct(p)}
                    className="group relative flex min-h-[92px] flex-col items-start justify-between rounded-2xl border border-slate-200 bg-white p-3 text-right shadow-sm transition hover:border-emerald-400 hover:shadow active:scale-[0.98]"
                  >
                    <span className="w-full truncate text-sm font-black text-slate-800">
                      {p.name}
                    </span>
                    <span className="w-full">
                      <span className="block text-sm font-black text-emerald-700">
                        {fmtMoney(p.price)}
                        {p.isWeighted && <span className="text-[10px] text-slate-400">/كجم</span>}
                      </span>
                      {showStock && (
                        <span className={`text-[10px] font-bold ${p.stock < 0 ? "text-red-500" : p.stock === 0 ? "text-slate-400" : "text-slate-400"}`}>
                          {p.stock < 0 ? `سالب ${fmtQty(-p.stock)}` : `مخزون ${fmtQty(p.stock)}`}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            /* بيع سريع */
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="mb-1 text-sm font-black text-slate-800">بيع سريع بدون أصناف</p>
              <p className="mb-4 text-xs leading-5 text-slate-500">
                للتاجر اللي مش عايز يحدد الصنف — المبيعات والخزنة تتحدث، والمخزون <b>لا يُلمس</b> لأننا مش عارفين إيه اللي خرج.
              </p>
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-slate-600">إجمالي البيع</span>
                <Input
                  type="number"
                  step="0.5"
                  inputMode="decimal"
                  placeholder="مثال: 150"
                  value={quickTotal}
                  onChange={(e) => setQuickTotal(e.target.value)}
                  className="text-xl font-black"
                  autoFocus
                />
              </label>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {[10, 20, 50, 100].map((v) => (
                  <button
                    key={v}
                    onClick={() => setQuickTotal(String(v))}
                    className="rounded-xl border border-slate-200 py-2 text-sm font-black text-slate-600 transition hover:border-emerald-400 hover:text-emerald-700"
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ------------------------- السلة والدفع ------------------------- */}
        <div className="lg:col-span-2">
          <div className="sticky top-20 rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <h3 className="text-sm font-black text-slate-800">الفاتورة الحالية</h3>
              {cart.length > 0 && (
                <button onClick={() => setCart([])} className="text-[11px] font-bold text-red-500 hover:underline">
                  تفريغ
                </button>
              )}
            </div>

            <div className="max-h-64 space-y-2 overflow-y-auto px-4 py-3">
              {cart.length === 0 && mode === "items" && (
                <p className="py-6 text-center text-sm text-slate-400">اضغط على المنتجات لإضافتها</p>
              )}
              {cart.map((i) => (
                <div key={i.key} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
                  <button onClick={() => removeItem(i.key)} className="text-slate-300 hover:text-red-500">
                    <Icon name="x" size={15} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-800">{i.name}</p>
                    <p className="text-[11px] text-slate-400">
                      {i.isWeighted ? fmtQty(i.qty) + " كجم" : fmtQty(i.qty)} × {fmtMoney(i.unitPrice)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setQty(i.key, 1)} className="rounded-lg bg-white px-2 py-0.5 text-emerald-700 shadow-sm hover:bg-emerald-50">
                      <Icon name="plus" size={13} />
                    </button>
                    <button onClick={() => setQty(i.key, -1)} className="rounded-lg bg-white px-2 py-0.5 text-slate-500 shadow-sm hover:bg-slate-100">
                      <Icon name="minus" size={13} />
                    </button>
                  </div>
                  <b className="w-16 text-left text-sm text-slate-800">{fmtMoney(i.qty * i.unitPrice)}</b>
                </div>
              ))}
            </div>

            <div className="space-y-3 border-t border-slate-100 px-4 py-4">
              {mode === "items" && (
                <div className="flex items-center gap-3">
                  <label className="text-xs font-bold text-slate-500">خصم</label>
                  <Input
                    type="number"
                    min={0}
                    value={discount || ""}
                    placeholder="0"
                    onChange={(e) => setDiscount(Number(e.target.value) || 0)}
                    className="w-24 py-1.5"
                  />
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-500">طريقة الدفع</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(["cash", "card", "wallet", "credit"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMethod(m)}
                      className={`rounded-xl py-2 text-xs font-black transition ${method === m ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
                    >
                      {METHOD_LABELS[m]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-500">العميل (اختياري — لازم للآجل)</label>
                <Select value={customerId || ""} onChange={(e) => setCustomerId(Number(e.target.value) || 0)}>
                  <option value="">بدون عميل</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.balance > 0 ? ` (عليه ${fmtMoney(c.balance)})` : ""}
                    </option>
                  ))}
                </Select>
                {method === "credit" && selectedCustomer && selectedCustomer.creditLimit > 0 && (
                  <p className="mt-1 text-[11px] text-slate-400">
                    حد الائتمان: {fmtMoney(selectedCustomer.creditLimit)} — رصيده الآن {fmtMoney(selectedCustomer.balance)}
                  </p>
                )}
              </div>

              {method === "credit" && (
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-500">دفع جزء الآن (اختياري)</label>
                  <Input
                    type="number"
                    min={0}
                    value={paidNow || ""}
                    placeholder="0"
                    onChange={(e) => setPaidNow(Number(e.target.value) || 0)}
                  />
                </div>
              )}

              <div className="flex items-center justify-between rounded-xl bg-slate-900 px-4 py-3">
                <span className="text-sm font-bold text-slate-300">الإجمالي</span>
                <span className="text-xl font-black text-white">{fmtMoney(mode === "quick" ? Number(quickTotal) || 0 : total)}</span>
              </div>
              {method === "credit" && mode === "items" && total > paidNow && (
                <p className="text-[11px] text-slate-400">
                  الآجل: {fmtMoney(total - paidNow)} يُضاف على حساب {selectedCustomer?.name ?? "العميل"}
                </p>
              )}
              {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
              <Btn className="w-full" size="xl" loading={busy} onClick={complete}>
                <Icon name="check" size={20} />
                إتمام البيع
              </Btn>
            </div>
          </div>
        </div>
      </div>

      {/* إنشاء منتج أثناء البيع */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="منتج جديد على السريع ⚡">
        <div className="space-y-3">
          <Field label="اسم المنتج">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="سعر البيع (ج.م)">
              <Input type="number" step="0.5" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="10" />
            </Field>
            <Field label="يباع بالوزن؟">
              <button
                type="button"
                onClick={() => setNewWeighted((v) => !v)}
                className={`mt-1 flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-sm font-bold ${newWeighted ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-300 text-slate-500"}`}
              >
                كيلو / جرام
                <Icon name={newWeighted ? "check" : "x"} size={15} />
              </button>
            </Field>
          </div>
          <p className="text-[11px] leading-4 text-slate-400">
            تكلفة الشراء والفئة تقدر تضيفهم بعدين من صفحة المنتجات — المهم دلوقتي متوقفش البيع.
          </p>
          <Btn className="w-full" size="lg" loading={busy} onClick={submitNewProduct}>
            أضيفه وأكمل البيع
          </Btn>
        </div>
      </Modal>

      {/* الإيصال */}
      {receipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <div id="receipt-print" className="p-6">
              <div className="text-center">
                <p className="text-lg font-black text-slate-900">مساعد التاجر</p>
                <p className="text-xs text-slate-500">فاتورة رقم #{String(receipt.number)}</p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {fmtDateShort(new Date(String(receipt.at)))} — {fmtTime(new Date(String(receipt.at)))}
                </p>
              </div>
              <div className="my-4 border-t border-dashed border-slate-300" />
              <div className="space-y-1.5 text-sm">
                {receiptItems.map((it, idx) => (
                  <div key={idx} className="flex justify-between gap-2">
                    <span className="text-slate-600">
                      {it.name} {it.qty !== 1 && <b className="text-slate-400">×{fmtQty(it.qty)}</b>}
                    </span>
                    <b className="text-slate-800">{fmtMoney(it.total)}</b>
                  </div>
                ))}
              </div>
              <div className="my-4 border-t border-dashed border-slate-300" />
              <div className="space-y-1 text-sm">
                {Number(receipt.discount) > 0 && (
                  <div className="flex justify-between text-slate-500">
                    <span>خصم</span>
                    <span>-{fmtMoney(Number(receipt.discount))}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-black text-slate-900">
                  <span>الإجمالي</span>
                  <span>{fmtMoney(Number(receipt.total))}</span>
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>الدفع: {String(receipt.method) === "credit" ? `آجل (مدفوع ${fmtMoney(Number(receipt.paid))})` : METHOD_LABELS[String(receipt.method)]}</span>
                  {String(receipt.method) === "credit" && <span>الباقي: {fmtMoney(Number(receipt.total) - Number(receipt.paid))}</span>}
                </div>
              </div>
              <p className="mt-4 text-center text-[11px] text-slate-400">شكرًا لزيارتك 🙏</p>
            </div>
            <div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-4 no-print">
              <Btn variant="outline" onClick={() => window.print()}>
                <Icon name="print" size={16} />
                طباعة
              </Btn>
              <Btn onClick={startNew}>بيع جديد</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
