import { NextResponse } from "next/server";
import { getAuth, can } from "@/lib/auth";
import { assistantHandle } from "@/lib/assistant";

export async function POST(req: Request) {
  let body: { message?: string; confirm?: Record<string, unknown> | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }
  const message = (body.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "اكتب رسالة" }, { status: 400 });

  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "غير مسجل" }, { status: 401 });
  if (!can(auth.role, "assistant"))
    return NextResponse.json({ error: "غير مصرح لك باستخدام المساعد" }, { status: 403 });

  try {
    const result = await assistantHandle(
      auth,
      message,
      (body.confirm as { op: string } | null | undefined) ?? null,
    );
    return NextResponse.json(result);
  } catch (e) {
    console.error("[assistant]", e);
    return NextResponse.json(
      { reply: "حصلت مشكلة تقنية — جرب تاني بعد ثانية. (النظام الأساسي شغال عادي)" },
      { status: 200 },
    );
  }
}
