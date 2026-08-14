import type { Auth } from "@/lib/auth";
import { can } from "@/lib/auth";
import {
  recordCustomerPayment,
  recordSupplierPayment,
  recordExpense,
  createPurchase,
  createProduct,
  openCashSession,
  closeCashSession,
  cashIn,
  cashOut,
} from "@/lib/engine";
import {
  assistantContext,
  getAllCustomers,
  getAllSuppliers,
  getAllProducts,
  getLowStock,
} from "@/lib/queries";
import { fmtMoney, fmtQty, parseNumbers, parseNumber, fmtDateShort, EXPENSE_CATEGORIES } from "@/lib/money";

export type AssistantConfirmation = Record<string, unknown> & { op: string };
export type AssistantResult = {
  reply: string;
  confirmation?: AssistantConfirmation;
};

/* تطبيع النص العربي للبحث */
const norm = (s: string): string =>
  s
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/ـ/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .toLowerCase()
    .trim();

const fmtDay = (v: { sales: number; count: number; cash: number; credit: number }) =>
  [
    `💰 المبيعات: ${fmtMoney(v.sales)} — عدد الفواتير ${v.count}`,
    `   نقدي: ${fmtMoney(v.cash)}`,
    `   آجل: ${fmtMoney(v.credit)}`,
  ].join("\n");

export async function assistantHandle(
  auth: Auth,
  rawMessage: string,
  confirm?: AssistantConfirmation | null,
): Promise<AssistantResult> {
  const businessId = auth.business.id;
  const message = norm(rawMessage);

  /* ------------------------- تنفيذ أمر مؤكد ------------------------- */
  if (confirm) {
    switch (confirm.op) {
      case "customer_payment": {
        const customerId = Number(confirm.customerId);
        const amount = Number(confirm.amount);
        if (!customerId || !(amount > 0)) return { reply: "البيانات ناقصة — جرب تاني." };
        if (!can(auth.role, "expenses"))
          return { reply: "غير مصرح لك بتسجيل التحصيلات — اطلب من المدير." };
        const res = await recordCustomerPayment({ customerId, amount, note: confirm.note as string });
        if (!res.ok) return { reply: `ما قدرتش أسجل الدفعة: ${res.error}` };
        return {
          reply: `تمام ✅ قبضت ${fmtMoney(amount)} من ${confirm.name}.\nرصيده الحالي: ${fmtMoney(res.newBalance)}.`,
        };
      }
      case "supplier_payment": {
        const supplierId = Number(confirm.supplierId);
        const amount = Number(confirm.amount);
        if (!supplierId || !(amount > 0)) return { reply: "البيانات ناقصة — جرب تاني." };
        if (!can(auth.role, "purchases"))
          return { reply: "غير مصرح لك بالدفع للموردين — اطلب من المدير." };
        const res = await recordSupplierPayment({ supplierId, amount, note: confirm.note as string });
        if (!res.ok) return { reply: `ما قدرتش أسجل الدفعة: ${res.error}` };
        return { reply: `تمام ✅ دفعت ${fmtMoney(amount)} إلى ${confirm.name}.` };
      }
      case "expense": {
        const amount = Number(confirm.amount);
        if (!(amount > 0)) return { reply: "المبلغ غير صحيح." };
        if (!can(auth.role, "expenses"))
          return { reply: "غير مصرح لك بتسجيل المصروفات — اطلب من المدير." };
        const res = await recordExpense({
          amount,
          category: String(confirm.category || "أخرى"),
          note: confirm.note as string,
        });
        if (!res.ok) return { reply: `ما قدرتش أسجل المصروف: ${res.error}` };
        return { reply: `تمام ✅ سجلت مصروف «${confirm.category}» بمبلغ ${fmtMoney(amount)} وخصمته من الخزنة.` };
      }
      case "purchase": {
        const total = Number(confirm.total);
        const paid = Number(confirm.paid ?? 0);
        if (!(total > 0)) return { reply: "قيمة الشراء غير صحيحة." };
        if (!can(auth.role, "purchases"))
          return { reply: "غير مصرح لك بتسجيل المشتريات — اطلب من المدير." };
        const res = await createPurchase({
          supplierId: confirm.supplierId ? Number(confirm.supplierId) : undefined,
          items: [],
          paid,
          note: "شراء مسجل من المساعد — الأصناف تُضاف من صفحة الشراء",
        });
        if (!res.ok) return { reply: `ما قدرتش أسجل الشراء: ${res.error}` };
        return {
          reply: `تمام ✅ سجلت الشراء بقيمة ${fmtMoney(total)}${confirm.supplierName ? ` من ${confirm.supplierName}` : ""}، المدفوع ${fmtMoney(paid)}، والباقي ${fmtMoney(total - paid)}.\n\n⚠️ الأصناف والكميات مش مسجلة، فالمخزون لم يزد — أضفها من صفحة الشراء عشان الميزان يظبط.`,
        };
      }
      case "create_product": {
        const price = Number(confirm.price);
        if (!(price > 0)) return { reply: "سعر البيع غير صحيح." };
        if (!can(auth.role, "products"))
          return { reply: "غير مصرح لك بإضافة منتجات — اطلب من المدير." };
        const res = await createProduct({
          name: String(confirm.name),
          salePrice: price,
          costPrice: confirm.cost ? Number(confirm.cost) : undefined,
          unitId: Number(confirm.unitId),
          isWeighted: Boolean(confirm.isWeighted),
        });
        if (!res.ok) return { reply: `ما قدرتش أضيف المنتج: ${res.error}` };
        return {
          reply: `تمام ✅ أضفت «${res.product.name}» بسعر ${fmtMoney(res.product.salePrice)}.\nتقدر تبيعه الآن من نقطة البيع.`,
        };
      }
      case "open_cash": {
        if (!can(auth.role, "cash")) return { reply: "غير مصرح لك بفتح الخزنة." };
        const res = await openCashSession({ opening: Number(confirm.amount ?? 0) });
        if (!res.ok) return { reply: res.error };
        return { reply: `تمام ✅ فتحت الخزنة بمبلغ ${fmtMoney(Number(confirm.amount ?? 0))}. يوم شغل موفق!` };
      }
      case "close_cash": {
        if (!can(auth.role, "cash")) return { reply: "غير مصرح لك بإقفال الخزنة." };
        const res = await closeCashSession({
          actual: Number(confirm.actual),
          note: "إقفال من المساعد",
        });
        if (!res.ok) return { reply: res.error };
        const v = res.variance;
        return {
          reply: [
            `تمام ✅ أقفلت اليوم.`,
            `المتوقع: ${fmtMoney(res.expected)}`,
            `الفعلي: ${fmtMoney(res.actual)}`,
            v === 0
              ? "لا يوجد فرق — مظبوط 100% 🎯"
              : v < 0
                ? `⚠️ فيه عجز ${fmtMoney(Math.abs(v))} في الخزنة — راجع الفواتير والمصروفات من السجل الزمني.`
                : `فيه زيادة ${fmtMoney(v)} عن المتوقع.`,
          ].join("\n"),
        };
      }
      case "cash_in": {
        if (!can(auth.role, "cash")) return { reply: "غير مصرح لك." };
        const res = await cashIn({ amount: Number(confirm.amount), note: confirm.note as string });
        if (!res.ok) return { reply: res.error };
        return { reply: `تمام ✅ زوّدت الخزنة ${fmtMoney(Number(confirm.amount))}.` };
      }
      case "cash_out": {
        if (!can(auth.role, "cash")) return { reply: "غير مصرح لك." };
        const res = await cashOut({ amount: Number(confirm.amount), note: confirm.note as string });
        if (!res.ok) return { reply: res.error };
        return { reply: `تمام ✅ سحبت ${fmtMoney(Number(confirm.amount))} من الخزنة.` };
      }
      default:
        return { reply: "الأمر غير معروف — جرب صياغة تانية." };
    }
  }

  /* ------------------------- التوجيه (Queries) ------------------------- */
  const ctx = await assistantContext(businessId);

  // مبيعات اليوم
  if (
    (/(بعت|بعنا|بعتو|باع|بيعنا|مبيعات|الحصيله|الايراد|الإيراد)/.test(message) &&
      /(كام|كم|قد|ايه|إيه|النهارده|اليوم)/.test(message)) ||
    /(مبيعات|بعنا|باعو).*(اليوم|النهارده)/.test(message)
  ) {
    return {
      reply: `📊 مبيعات النهارده:\n${fmtDay(ctx.today)}\n${
        ctx.today.returns > 0 ? `\n↩️ مرتجعات اليوم: ${fmtMoney(ctx.today.returns)}` : ""
      }\n\nرصيد الخزنة المتوقع الآن: ${fmtMoney(ctx.session?.expected ?? 0)}.`,
    };
  }
  // مبيعات أمس
  if (/(امبارح|أمس|امس)/.test(message) && /(مبيعات|بعت|بيع)/.test(message)) {
    return { reply: `📊 مبيعات إمبارح:\n${fmtDay(ctx.yest)}` };
  }
  // الأسبوع
  if (/(الاسبوع|الأسبوع)/.test(message) && /(مبيعات|بعت|ملخص)/.test(message)) {
    const avg = ctx.week.sales / 7;
    const trend = ctx.prevWeek.sales > 0 ? ((ctx.week.sales - ctx.prevWeek.sales) / ctx.prevWeek.sales) * 100 : 0;
    return {
      reply: [
        `📊 مبيعات آخر 7 أيام: ${fmtMoney(ctx.week.sales)} (${ctx.week.count} فاتورة)`,
        `المتوسط اليومي: ${fmtMoney(avg)}`,
        trend === 0
          ? "مفيش بيانات أسبوع سابق للمقارنة."
          : `مقارنة بالأسبوع اللي فاته: ${trend > 0 ? "زيادة" : "انخفاض"} ${Math.abs(trend).toFixed(0)}%`,
      ].join("\n"),
    };
  }
  // مين عليه فلوس
  if (/(مين|مينه|اللي|الليا).*(عليه|عليهم|مديون|مديونين)|عليه فلوس|عليهم فلوس/.test(message)) {
    if (ctx.debtors.length === 0) return { reply: "مفيش حد عليه فلوس حاليًا 🎉" };
    return {
      reply: [
        `💰 العملاء اللي عليهم فلوس (الإجمالي ${fmtMoney(ctx.debtors.reduce((s, d) => s + d.balance, 0))}):`,
        ...ctx.debtors.map((d, i) => `${i + 1}. ${d.name}: ${fmtMoney(d.balance)}`),
        `\nتقدر تقبض منهم من صفحة «العملاء» أو قولّي مثلًا: «${ctx.debtors[0]?.name} دفع 100».`,
      ].join("\n"),
    };
  }
  // رصيد عميل معين
  {
    const custs = await getAllCustomers(businessId);
    const nameMatch = custs.filter((c) => message.includes(norm(c.name)));
    const hasActionVerb = /(دفع|سدد|سد|قبض|حاسب|مصروف|شراء|جبت|اشتريت)/.test(message);
    if (!hasActionVerb && nameMatch.length > 0 && /(كام|فلوس|باقي|رصيده|حسابه)/.test(message)) {
      return {
        reply: nameMatch
          .map((c) => `رصيد ${c.name}: ${c.balance > 0 ? `عليه ${fmtMoney(c.balance)}` : c.balance < 0 ? `له ${fmtMoney(-c.balance)}` : "خالص ✔️"}`)
          .join("\n"),
      };
    }
  }
  // مخزون منخفض
  if (
    /(قرب|قاربت|شارفت|ايه|إيه|ايهما|حد).*(يخلص|خلص|ناقص|نقص)/.test(message) ||
    /(مخزون|بضاعه|بضاعة).*(قليل|ناقص|قرب)/.test(message) ||
    /(ناقص|قليل).*(مخزون|بضاعه|بضاعة)/.test(message)
  ) {
    if (ctx.low.length === 0) return { reply: "المخزون كله تحت السيطرة ✅ مفيش أصناف قاربت تخلص." };
    return {
      reply: [
        `📦 الأصناف اللي محتاجة إعادة طلب:`,
        ...ctx.low.map((p) => `• ${p.name}: ${p.qty < 0 ? `سالب ${fmtQty(-p.qty)} ⚠️` : fmtQty(p.qty)} (الحد: ${fmtQty(p.reorder)})`),
        `\nتقدر تسجّل شراء من صفحة «الشراء» أو صفحة «المنتجات».`,
      ].join("\n"),
    };
  }
  // الخزنة
  if (/(الخزنه|الدرج|الكاش|خزنتي|فلوسي|الصندوق)/.test(message)) {
    if (!ctx.session) {
      return {
        reply: "الخزنة مقفولة حاليًا.\nقولّي مثلًا «افتح الخزنة بـ 5000» وسأفتحها لك.",
      };
    }
    return {
      reply: [
        `💵 وضع الخزنة:`,
        `فتح اليوم بمبلغ: ${fmtMoney(ctx.session.opening)}`,
        `الرصيد المتوقع الآن: ${fmtMoney(ctx.session.expected)}`,
        `منه مبيعات نقدية اليوم: ${fmtMoney(ctx.today.cash)}، وآجل: ${fmtMoney(ctx.today.credit)}`,
        ``,
        `التفاصيل الكاملة في صفحة «الخزنة»، ولإقفال اليوم: «اقفل الخزنة» وحطّ المبلغ الفعلي.`,
      ].join("\n"),
    };
  }
  // الأكثر مبيعًا
  if (/(اكتر|الأكثر|أكثر).*(مبيعا|مبيع|بيتباع|بيتباعوا)|(بيتباع اكتر)/.test(message)) {
    if (ctx.topProducts.length === 0) return { reply: "لسه مفيش مبيعات كافية اليوم." };
    return {
      reply: [
        `🏆 الأكثر مبيعًا النهارده:`,
        ...ctx.topProducts.slice(0, 5).map((t, i) => `${i + 1}. ${t.name} — ${fmtMoney(t.revenue)}`),
      ].join("\n"),
    };
  }
  // الربح
  if (/(ربح|كسبت|مكسب|الأرباح|صافي)/.test(message)) {
    const gross = ctx.today.sales - ctx.topProducts.reduce((s, t) => s + Math.max(0, t.revenue - t.profit), 0) - ctx.today.sales + ctx.today.sales;
    void gross;
    const revenue = ctx.today.sales;
    const knownCost = ctx.topProducts.reduce((s, t) => s + (t.revenue - t.profit), 0);
    const grossProfit = revenue - knownCost;
    return {
      reply: [
        `📈 تقدير اليوم (من الأصناف المبيعة):`,
        `المبيعات: ${fmtMoney(revenue)}`,
        `تكلفة الأصناف: ${fmtMoney(knownCost)}`,
        `الربح الإجمالي التقديري: ${fmtMoney(grossProfit)}`,
        ``,
        `⚠️ ده تقدير للبيع بالتفاصيل فقط — البيع السريع والمصروفات داخلين في التقارير التفصيلية من صفحة «التقارير».`,
      ].join("\n"),
    };
  }
  // ملخص / أهم حاجة
  if (/(ملخص|المختصر|محتاج|اهتمام|اركز|ركز|اخبار|أخبار|وضع المحل)/.test(message)) {
    const alerts = ctx.alerts.slice(0, 3);
    return {
      reply: [
        `🧭 نبذة النهارده:`,
        `• المبيعات: ${fmtMoney(ctx.today.sales)} (${ctx.today.count} فاتورة)`,
        `• الخزنة المتوقعة: ${fmtMoney(ctx.session?.expected ?? 0)}`,
        `• لك عند العملاء: ${fmtMoney(ctx.debtors.reduce((s, d) => s + d.balance, 0))}`,
        `• عليك للموردين: ${fmtMoney(ctx.supDebts.reduce((s, d) => s + d.balance, 0))}`,
        ``,
        alerts.length > 0
          ? `الأهم اللي محتاج انتباهك:\n${alerts.map((a, i) => `${i + 1}. ${a.title}${a.body ? ` — ${a.body}` : ""}`).join("\n")}`
          : "مفيش حاجة حرجة حاليًا ✅",
      ].join("\n"),
    };
  }
  // ليه المبيعات قلت
  if (/(ليه|ليش|عشان|سبب)/.test(message) && /(قل|قلت|نزلت|نقصت|منخفضه)/.test(message)) {
    const todaySales = ctx.today.sales;
    const weekAvg = ctx.week.sales / 7;
    if (todaySales < weekAvg * 0.6 && weekAvg > 0) {
      const drop = ((weekAvg - todaySales) / weekAvg) * 100;
      return {
        reply: [
          `📉 مبيعات اليوم أقل من متوسط الأسبوع بنسبة ${drop.toFixed(0)}%.`,
          ``,
          `الأصناف الأكثر تأثرًا (بيانات حقيقية):`,
          ...ctx.topProducts.slice(0, 3).map((t) => `• ${t.name}: ${fmtMoney(t.revenue)}`),
          ``,
          ctx.low.length > 0
            ? `⚠️ فيه ${ctx.low.length} أصناف مخزونها منخفض — نفاد المخزون ممكن يكون سبب في الانخفاض (ده استنتاج مش مؤكد).`
            : "المخزون مستقر، فالأرجح السبب حركة السوق.",
          ``,
          "لو عايز تحليل أعمق، افتح صفحة «التقارير». الأرقام دي كلها من بياناتك الحقيقية.",
        ].join("\n"),
      };
    }
    return {
      reply: `المبيعات النهارده ${fmtMoney(todaySales)} مقارنة بمتوسط الأسبوع ${fmtMoney(weekAvg)} — الفرق مش كبير. ممكن تشوف التفاصيل من صفحة «التقارير».`,
    };
  }

      /* ------------------------- الأوامر (Actions) ------------------------- */
  // شراء من مورد
  if (/(جبت|جابو|جاب من|شرا|شراء|اشتريت|اشترينا|بضاعه من|بضاعة من)/.test(message)) {
    const nums = parseNumbers(message);
    if (nums.length === 0) return { reply: "الشراء بكام؟ قولّي مثلًا: «جبت بضاعة من محمد بـ 3500 ودفعت له 2000»." };
    const total = nums[0];
    const paid = /(دفعت|دفع|حاسبت|حاسب)/.test(message) && nums.length > 1 ? nums[1] : 0;
    const sups = await getAllSuppliers(businessId);
    const matches = sups.filter((s) => message.includes(norm(s.name)));
    if (matches.length > 1)
      return { reply: `فيه أكتر من مورد بنفس الاسم: ${matches.map((m) => m.name).join("، ")}. حدد اسمه كامل.` };
    const supplier = matches[0];
    return {
      reply: `سأسجل شراء بقيمة ${fmtMoney(total)}${supplier ? ` من ${supplier.name}` : ""}، المدفوع ${fmtMoney(Math.min(paid, total))}، والباقي ${fmtMoney(total - Math.min(paid, total))} آجل.\n⚠️ الأصناف مش هتتسجل هنا — ضيفها من صفحة الشراء.\nاكد؟`,
      confirmation: {
        op: "purchase",
        total,
        paid: Math.min(paid, total),
        supplierId: supplier?.id,
        supplierName: supplier?.name,
      },
    };
  }
  // دفع لمورد
  if (/(دفعت للمورد|دفعنا للمورد|حاسبت المورد|ادفع للمورد|دفعنا ل|دفعت ل)/.test(message)) {
    const nums = parseNumbers(message);
    const amount = nums[nums.length - 1];
    if (!amount) return { reply: "الدفعة بكام؟" };
    const sups = await getAllSuppliers(businessId);
    const matches = sups.filter((s) => message.includes(norm(s.name)));
    if (matches.length === 0)
      return { reply: `مش لاقي مورد بهذا الاسم. الموردين عندك: ${sups.length ? sups.map((s) => s.name).join("، ") : "لسه مفيش موردين"}.` };
    if (matches.length > 1)
      return { reply: `فيه أكتر من مورد: ${matches.map((m) => m.name).join("، ")}. حدد الاسم كامل.` };
    const s = matches[0];
    return {
      reply: `سأسجل دفع ${fmtMoney(amount)} إلى المورد ${s.name} ويخصم من الخزنة.\nاكد؟`,
      confirmation: { op: "supplier_payment", supplierId: s.id, name: s.name, amount },
    };
  }
  // قبض من عميل
  if (/(دفع|سدد|سد|حاسب|قبضنا|قبض)/.test(message)) {
    const nums = parseNumbers(message);
    const amount = nums[nums.length - 1];
    const custs = await getAllCustomers(businessId);
    const matches = custs.filter((c) => message.includes(norm(c.name)));
    if (matches.length === 0) {
      return {
        reply: `مين اللي دفع؟ العملاء عندك: ${custs.slice(0, 8).map((c) => c.name).join("، ")}${custs.length > 8 ? "…" : ""}.\nقولّي: «فلان دفع 500».`,
      };
    }
    if (!amount) return { reply: "دفع كام؟ قولّي: «فلان دفع 500»." };
    if (matches.length > 1)
      return {
        reply: `فيه أكتر من واحد بهذا الاسم:\n${matches.map((m, i) => `${i + 1}. ${m.name} (رصيده ${fmtMoney(m.balance)})`).join("\n")}\nحدد مين بالظبط.`,
      };
    const c = matches[0];
    return {
      reply: `سأسجل قبض ${fmtMoney(amount)} من ${c.name}${c.balance > 0 ? ` (رصيده الحالي ${fmtMoney(c.balance)})` : ""}.\nاكد؟`,
      confirmation: { op: "customer_payment", customerId: c.id, name: c.name, amount },
    };
  }
  // مصروف (بعد فحص الدفعات — عشان «دفعت للمورد» متتلخبطش)
  if (/(مصروف|مصاريف)/.test(message) || ((/(دفعت|دفعنا|ادفع)/.test(message)) && !/(مورد|للمورد)/.test(message) && !/(دفعنا ل|دفعت ل)/.test(message))) {
    const nums = parseNumbers(message);
    const amount = nums[nums.length - 1];
    if (!amount) return { reply: "سجّل المصروف بكام؟ قولّي مثلًا: «سجل مصروف كهرباء 300»." };
    const category =
      EXPENSE_CATEGORIES.find((c) => message.includes(norm(c))) ?? "أخرى";
    return {
      reply: `سأسجل مصروف «${category}» بمبلغ ${fmtMoney(amount)} ويخصم من الخزنة.\nاكد؟`,
      confirmation: { op: "expense", amount, category },
    };
  }
  // إضافة منتج
  if (/(ضيف|أضف|اضيف|اعمل).*(منتج|صنف)/.test(message)) {
    const nums = parseNumbers(message);
    const price = nums[nums.length - 1];
    const nameRaw = rawMessage.replace(/^(ضيف|أضف|اضيف|اعمل)\s*(منتج|صنف)?\s*/i, "");
    const name = nameRaw.replace(/(بـ|ب|سعر|بسعر)\s*\d+(\.\d+)?.*$/g, "").trim();
    if (!name || !price) {
      return { reply: "قولّي اسم المنتج وسعره، مثلًا: «ضيف منتج لبن بسعر 40»." };
    }
    const unitId = (await getUnitId(businessId)) ?? 0;
    const isWeighted = /(كيلو|بالوزن|وزن)/.test(message);
    const prods = await getAllProducts(businessId);
    const dup = prods.find((p) => norm(p.name) === norm(name));
    if (dup) return { reply: `فيه منتج بنفس الاسم أصلًا: «${dup.name}» بسعر ${fmtMoney(dup.salePrice)}. لو تقصد غيره، سمّيه اسم مختلف.` };
    return {
      reply: `سأضيف «${name}» بسعر بيع ${fmtMoney(price)}${isWeighted ? " (يباع بالوزن/كيلو)" : ""}.\nاكد؟`,
      confirmation: { op: "create_product", name, price, unitId, isWeighted },
    };
  }
  // فتح الخزنة
  if (/(فتح|افتح|افتحي).*(خزنه|درج|اليوم)/.test(message)) {
    const amount = parseNumber(message) ?? 0;
    return {
      reply: `سأفتح الخزنة بمبلغ ${fmtMoney(amount)}.\nاكد؟`,
      confirmation: { op: "open_cash", amount },
    };
  }
  // إقفال الخزنة
  if (/(قفل|اقفل|اغلق|اقفال|اقفلي).*(خزنه|درج|اليوم)/.test(message)) {
    const actual = parseNumber(message);
    if (!actual) {
      return {
        reply: `لإقفال اليوم: عدّ الفلوس اللي في الدرج فعلًا وقولّي «اقفل الخزنة والمبلغ الفعلي X». المتوقع حاليًا: ${fmtMoney(ctx.session?.expected ?? 0)}.`,
      };
    }
    return {
      reply: `سأقفل الخزنة بمبلغ فعلي ${fmtMoney(actual)} (المتوقع ${fmtMoney(ctx.session?.expected ?? 0)}).\nاكد؟`,
      confirmation: { op: "close_cash", actual },
    };
  }
  // إيراد آخر / سحب
  if (/(حطيت|دخلت|زويد|زوّد|وديت)/.test(message) && parseNumber(message)) {
    const amount = parseNumber(message)!;
    return { reply: `سأزود الخزنة ${fmtMoney(amount)} كإيراد آخر.\nاكد؟`, confirmation: { op: "cash_in", amount } };
  }
  if (/(سحبت|اخدت|أخدت|سحب)/.test(message) && parseNumber(message)) {
    const amount = parseNumber(message)!;
    return { reply: `سأسجل سحب ${fmtMoney(amount)} من الخزنة.\nاكد؟`, confirmation: { op: "cash_out", amount } };
  }
  // إرشاد
  if (/(ازاي|إزاي|اعمل|أعمل|مش عارف|معرفش)/.test(message)) {
    return {
      reply: [
        "أنا معاك — تقدر تسألني أو تنفذ معايا مباشرة 👇",
        "",
        "الأسئلة:",
        "• «بعت كام النهارده؟» — مبيعات اليوم",
        "• «مين عليه فلوس؟» — العملاء المدينون",
        "• «إيه اللي قرب يخلص؟» — المخزون المنخفض",
        "• «الخزنة فيها كام؟» — الرصيد المتوقع",
        "• «اعمللي ملخص» — نبذة النهارده",
        "",
        "الأوامر:",
        "• «محمد دفع 500 من حسابه» — تحصيل",
        "• «سجل مصروف كهرباء 300» — مصروف",
        "• «ضيف منتج لبن بسعر 40» — منتج جديد",
        "• «جبت بضاعة من شركة الجميل بـ 3500 ودفعت 2000» — شراء",
        "• «افتح الخزنة بـ 5000» / «اقفل الخزنة» — يومية الخزنة",
        "",
        "وللعمليات الحساسة هطلب تأكيدك الأول، وكل اللي أقوله من بيانات المحل الحقيقية.",
      ].join("\n"),
    };
  }

  return {
    reply: [
      "مقدرتش أفهم دي بالظبط 🤔 — جرب صياغة زي:",
      "• «بعت كام النهارده؟»",
      "• «مين عليه فلوس؟»",
      "• «إيه اللي قرب يخلص؟»",
      "• «الخزنة فيها كام؟»",
      "• «محمد دفع 500»",
      "• «سجل مصروف كهرباء 300»",
      "• «ازاي أضيف منتج؟»",
    ].join("\n"),
  };
}

/* وحدة افتراضية للمنتجات الجديدة (يفضل القطعة) */
async function getUnitId(businessId: number): Promise<number | null> {
  const { db } = await import("@/db");
  const { units } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(units)
    .where(eq(units.businessId, businessId))
    .limit(20);
  const piece = rows.find((u) => u.kind === "piece");
  return (piece ?? rows[0])?.id ?? null;
}

export { fmtDateShort };
