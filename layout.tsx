import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getAlerts, ensureSeeded } from "@/lib/queries";
import Shell from "@/components/Shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth();
  try {
    await ensureSeeded();
  } catch (e) {
    console.error("[seed]", e);
  }
  const alerts = await getAlerts(auth.business.id);
  return (
    <Shell
      user={{ id: auth.user.id, name: auth.user.name }}
      business={{ id: auth.business.id, name: auth.business.name, type: auth.business.type }}
      role={auth.role}
      memberships={auth.memberships}
      alerts={alerts}
    >
      {children}
    </Shell>
  );
}
