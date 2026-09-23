"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchCustomers, type CustomerSummary } from "../../../lib/api";
import { AdminShell, Card, EmptyState, ErrorNote } from "../../../components/AdminShell";
import { Badge } from "../../../components/Badge";
import { SearchIcon } from "../../../components/icons";
import { MFA_LABELS, formatDateTime, formatMoney } from "../../../lib/format";

export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<CustomerSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCustomers()
      .then(({ customers }) => setCustomers(customers))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  // Small, fixed customer set — filter client-side.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!customers || !needle) return customers;
    return customers.filter((c) => [c.name, c.ban, c.phoneNumber, c.email, c.id].some((v) => v.toLowerCase().includes(needle)));
  }, [customers, q]);

  return (
    <AdminShell title="Customers" subtitle="Accounts, verification setup, and call history.">
      <ErrorNote error={error} />
      <Card>
        <label className="relative mb-4 block max-w-sm">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, BAN, phone, email…"
            className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none"
          />
        </label>
        {!filtered ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : filtered.length === 0 ? (
          <EmptyState>No customers match.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="py-3 pr-4">Customer</th>
                  <th className="py-3 pr-4">BAN</th>
                  <th className="py-3 pr-4">Phone</th>
                  <th className="py-3 pr-4">Verification</th>
                  <th className="py-3 pr-4">Plan</th>
                  <th className="py-3 pr-4 text-right">Balance</th>
                  <th className="py-3 pr-4 text-right">Calls</th>
                  <th className="py-3 pr-4">Last call</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} onClick={() => router.push(`/admin/customers/${c.id}`)} className="cursor-pointer border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 pr-4">
                      <p className="font-semibold text-gray-900">{c.name}</p>
                      <p className="text-xs text-gray-500">{c.email}</p>
                    </td>
                    <td className="py-3 pr-4 text-gray-600 tabular-nums">{c.ban}</td>
                    <td className="py-3 pr-4 text-gray-600 tabular-nums">{c.phoneNumber}</td>
                    <td className="py-3 pr-4">
                      <Badge tone={c.mfaMethod === "NONE" ? "neutral" : "info"}>{MFA_LABELS[c.mfaMethod]}</Badge>
                      {c.hasPortalAccount && <span className="ml-2 text-xs text-gray-500">portal</span>}
                    </td>
                    <td className="py-3 pr-4 text-gray-600">{c.planName}</td>
                    <td className="py-3 pr-4 text-right tabular-nums">
                      <span className="text-gray-900">{formatMoney(c.currentBalance)}</span>
                      {c.pastDueAmount > 0 && <p className="text-xs text-red-600">{formatMoney(c.pastDueAmount)} past due</p>}
                    </td>
                    <td className="py-3 pr-4 text-right text-gray-600 tabular-nums">{c.callCount ?? 0}</td>
                    <td className="whitespace-nowrap py-3 pr-4 text-gray-600">{formatDateTime(c.lastCallAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AdminShell>
  );
}
