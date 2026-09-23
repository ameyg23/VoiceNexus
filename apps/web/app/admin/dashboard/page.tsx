"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { employeeLogout, employeeMe, fetchDashboardSummary, type DashboardSummary, type EmployeeAccount } from "../../../lib/api";
import { Sidebar } from "../../../components/Sidebar";
import { Badge } from "../../../components/Badge";

export default function AdminDashboardPage() {
  const router = useRouter();
  const [employee, setEmployee] = useState<EmployeeAccount | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    employeeMe()
      .then(({ employee }) => {
        setEmployee(employee);
        return fetchDashboardSummary();
      })
      .then(setSummary)
      .catch(() => router.replace("/admin/login"))
      .finally(() => setLoading(false));
  }, [router]);

  async function handleLogout() {
    await employeeLogout();
    router.push("/admin/login");
  }

  if (loading || !employee) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-gray-400">Loading…</div>;
  }

  const authRate =
    summary && summary.totalConversations > 0 ? Math.round((summary.authSuccess / summary.totalConversations) * 100) : 0;

  return (
    <div className="flex min-h-screen">
      <Sidebar orgName="Springfield Fiber" employeeName={employee.name} onLogout={() => void handleLogout()} />
      <main className="flex-1 px-8 py-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard overview</h1>
        <p className="mt-1 text-sm text-gray-500">Live snapshot from every call so far.</p>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <KpiTile label="Total Calls" value={summary?.totalConversations ?? 0} />
          <KpiTile label="Authenticated" value={summary?.authSuccess ?? 0} tone="success" />
          <KpiTile label="Auth Failed" value={summary?.authFailed ?? 0} tone="danger" />
          <KpiTile label="In Progress" value={summary?.authPending ?? 0} tone="neutral" />
        </div>

        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">Auth success rate</h2>
          <p className="mt-1 text-3xl font-bold text-gray-900">{authRate}%</p>
          <p className="mt-1 text-sm text-gray-500">
            {summary?.authSuccess ?? 0} of {summary?.totalConversations ?? 0} calls authenticated
          </p>
        </div>

        <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-400">
          Calls list, Intents, Escalations, Reports, and Integrations land Saturday — see the sidebar.
        </div>
      </main>
    </div>
  );
}

function KpiTile({ label, value, tone }: { label: string; value: number; tone?: "success" | "danger" | "neutral" }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
      {tone && (
        <div className="mt-2">
          <Badge tone={tone}>{tone === "success" ? "Good" : tone === "danger" ? "Needs review" : "Ongoing"}</Badge>
        </div>
      )}
    </div>
  );
}
