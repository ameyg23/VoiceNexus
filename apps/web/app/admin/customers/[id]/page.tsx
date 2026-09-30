"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fetchCustomer } from "../../../../lib/api";
import { AdminShell, Card, ErrorNote, StatTile } from "../../../../components/AdminShell";
import { Badge } from "../../../../components/Badge";
import { CallsTable } from "../../../../components/CallsTable";
import { ACTION_LABELS, formatDateOnly, formatDateTime, formatMoney } from "../../../../lib/format";

type CustomerDetail = Awaited<ReturnType<typeof fetchCustomer>>;

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCustomer(id)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error && err.message.startsWith("404") ? `No customer with ID ${id}.` : String(err)));
  }, [id]);

  const c = detail?.customer;

  return (
    <AdminShell
      title={c ? c.name : id}
      subtitle={
        <Link href="/admin/customers" className="text-brand-600 hover:text-brand-700">
          ← All customers
        </Link>
      }
    >
      <ErrorNote error={error} />
      {detail && c && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Current balance" value={formatMoney(c.currentBalance)} hint={c.pastDueAmount > 0 ? `${formatMoney(c.pastDueAmount)} past due` : "Nothing past due"} />
            <StatTile label="Next bill due" value={c.nextBillingDueDate ?? "-"} />
            <StatTile label="Last payment" value={formatMoney(c.lastPaymentAmount)} hint={c.lastPaymentDate ?? undefined} />
            <StatTile label="Calls" value={detail.stats.total} hint={`${detail.stats.resolved} resolved · ${detail.stats.escalated} escalated`} />
          </div>

          <Card className="mt-6" title="Account">
            <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Customer ID" value={c.id} />
              <Field label="BAN" value={c.ban} />
              <Field label="Phone (ANI on file)" value={c.phoneNumber} />
              <Field label="Email" value={c.email} />
              <Field label="Plan" value={`${c.planName}${c.discountPercent > 0 ? ` · ${c.discountPercent}% discount` : ""}`} />
              <Field label="Account status" value={c.accountStatus} />
              <Field label="Autopay" value={c.autopayEnabled ? "On" : "Off"} />
              <Field label="Portal account" value={c.hasPortalAccount ? "Yes" : "No"} />
              <Field label="Service ZIP" value={c.serviceZip ?? "-"} />
            </dl>
          </Card>

          <Card className="mt-6" title="Bookings & transactions" subtitle="What the assistant did on this account">
            {detail.actions.length === 0 ? (
              <p className="text-sm text-gray-500">Nothing yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100 text-sm">
                {detail.actions.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <span className="text-gray-800">
                      <span className="font-medium">{ACTION_LABELS[a.type]}</span> · {a.description}
                    </span>
                    <span className="flex items-center gap-3 text-gray-500">
                      {a.scheduledFor ? formatDateOnly(a.scheduledFor) : formatDateTime(a.createdAt)}
                      <Badge tone={a.status === "SCHEDULED" ? "warning" : a.status === "CANCELLED" ? "neutral" : "success"}>{a.status.toLowerCase()}</Badge>
                      <Link href={`/admin/calls/${a.conversationId}`} className="text-brand-600 hover:text-brand-700">
                        {a.conversationId}
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="mt-6" title="Call history" subtitle="Calls where this account's BAN was matched">
            <CallsTable calls={detail.conversations} showCustomer={false} empty="No calls matched to this account yet." />
          </Card>
        </>
      )}
    </AdminShell>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-gray-900">{value}</dd>
    </div>
  );
}
