"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { logout, customerMe, type CustomerAccount } from "../../../lib/api";
import { TopBar } from "../../../components/TopBar";
import { Badge } from "../../../components/Badge";

export default function PortalAccountPage() {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerAccount | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    customerMe()
      .then(({ customer }) => setCustomer(customer))
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  if (loading || !customer) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-gray-400">Loading…</div>;
  }

  return (
    <>
      <TopBar eyebrow="My account" />
      <main className="mx-auto max-w-2xl px-6 py-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Welcome, {customer.name.split(" ")[0]}</h1>
            <p className="mt-1 text-sm text-gray-500">
              Account number: <span className="font-mono font-medium text-gray-700">{customer.ban}</span> — use
              this (and your PIN) to verify yourself when you call in.
            </p>
          </div>
          <button
            onClick={() => void handleLogout()}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 shadow-sm transition hover:bg-gray-50"
          >
            Sign out
          </button>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Tile label="Current Balance" value={`$${customer.currentBalance.toFixed(2)}`} />
          <Tile
            label="Past Due"
            value={`$${customer.pastDueAmount.toFixed(2)}`}
            tone={customer.pastDueAmount > 0 ? "danger" : "success"}
          />
          <Tile label="Next Bill Due" value={customer.nextBillingDueDate ?? "—"} />
          <Tile label="Plan" value={customer.planName} />
          <Tile
            label="Autopay"
            value={customer.autopayEnabled ? "On" : "Off"}
            tone={customer.autopayEnabled ? "success" : "neutral"}
          />
          <Tile label="Last Payment" value={`$${customer.lastPaymentAmount.toFixed(2)}`} />
        </div>

        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">Account status</h2>
          <div className="mt-2">
            <Badge tone={customer.accountStatus === "ACTIVE" ? "success" : "warning"}>{customer.accountStatus}</Badge>
          </div>
        </div>
      </main>
    </>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" | "neutral" }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-2 text-xl font-bold text-gray-900">{value}</p>
      {tone && (
        <div className="mt-2">
          <Badge tone={tone}>{tone === "success" ? "Good" : tone === "danger" ? "Attention" : "—"}</Badge>
        </div>
      )}
    </div>
  );
}
