/* أدوات المال والأرقام — آمنة للاستخدام في العميل والخادم */

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export const arabicDigits = (s: string): string =>
  s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));

/** تحويل أي قيمة مالية (سلسلة numeric أو رقم) إلى قروش (عدد صحيح) */
export const toQ = (v: string | number | null | undefined): number =>
  Math.round((Number(v) || 0) * 100);

/** من قروش إلى سلسلة numeric جاهزة لقاعدة البيانات */
export const n = (q: number): string => (q / 100).toFixed(2);

/** كمية بثلاث خانات عشرية */
export const nq = (q: number): string =>
  q.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
    useGrouping: false,
  });

/** من قروش إلى جنيه (رقم حقيقي) للعرض */
export const fromQ = (q: number): number => q / 100;

const numFmt = new Intl.NumberFormat("ar-EG", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export const fmtNum = (v: string | number | null | undefined): string =>
  numFmt.format(Number(v) || 0);

export const fmtMoney = (v: string | number | null | undefined): string =>
  `${numFmt.format(Number(v) || 0)} ج.م`;

const qtyFmt = new Intl.NumberFormat("ar-EG", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

export const fmtQty = (v: string | number | null | undefined): string =>
  qtyFmt.format(Number(v) || 0);

export const fmtDate = (d: Date | string): string =>
  new Intl.DateTimeFormat("ar-EG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(d));

export const fmtDateShort = (d: Date | string): string =>
  new Intl.DateTimeFormat("ar-EG", {
    day: "numeric",
    month: "short",
  }).format(new Date(d));

export const fmtTime = (d: Date | string): string =>
  new Intl.DateTimeFormat("ar-EG", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(d));

export const fmtDateTime = (d: Date | string): string =>
  `${fmtDateShort(d)} — ${fmtTime(d)}`;

/** استخراج أول رقم موجود في النص (يدعم الأرقام العربية) */
export const parseNumber = (s: string): number | null => {
  const normalized = arabicDigits(s);
  const m = normalized.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
  const match = m.match(/\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
};

/** كل الأرقام الموجودة في النص */
export const parseNumbers = (s: string): number[] => {
  const normalized = arabicDigits(s);
  const matches = normalized.match(/\d+(?:\.\d+)?/g);
  return matches ? matches.map((x) => parseFloat(x)) : [];
};

/** قائمة فئات المصروفات */
export const EXPENSE_CATEGORIES = [
  "كهرباء",
  "إيجار",
  "مياه",
  "رواتب",
  "صيانة",
  "نقل",
  "اتصالات",
  "نثريات",
  "أخرى",
];

export const BUSINESS_TYPE_LABELS: Record<string, string> = {
  supermarket: "سوبر ماركت",
  attara: "عطارة",
  general: "محل عام",
};

export const METHOD_LABELS: Record<string, string> = {
  cash: "نقدي",
  card: "كارت",
  wallet: "محفظة",
  credit: "آجل",
  other: "أخرى",
};

export const CASH_TYPE_LABELS: Record<string, string> = {
  opening: "فتح خزنة",
  cash_sale: "بيع نقدي",
  collection: "تحصيل من عميل",
  other_in: "إيراد آخر",
  cash_purchase: "شراء نقدي",
  expense: "مصروف",
  supplier_payment: "دفع لمورد",
  withdrawal: "سحب",
  sale_refund: "مرتجع بيع",
  adjustment: "تسوية",
};
