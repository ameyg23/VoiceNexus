"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { logout, customerMe, customerActivity, type CustomerAccount, type CustomerActivity } from "../../../lib/api";
import { Badge } from "../../../components/Badge";
import { LogoMark, PhoneIcon, CalendarIcon, CheckIcon, LogoutIcon } from "../../../components/icons";
import { ACTION_LABELS, formatDateOnly, formatDateTime, formatMoney } from "../../../lib/format";

// Customer self-service portal: what they owe and when, their plan, anything the assistant booked for
// them, and how to reach the care line (with the BAN they'll be asked for).
export default function PortalAccountPage() {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerAccount | null>(null);
  const [activity, setActivity] = useState<CustomerActivity | null>(null);

  useEffect(() => {
    customerMe()
      .then(({ customer }) => {
        setCustomer(customer);
        return customerActivity().then(setActivity);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  if (!customer) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-gray-400">Loading…</div>;
  }

  const brand = activity?.brandName ?? "Springfield Fiber";
  const pastDue = customer.pastDueAmount > 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <span className="flex items-center gap-2">
            <LogoMark className="h-7 w-7" />
            <span className="text-lg font-bold text-gray-900">{brand}</span>
          </span>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-gray-600 sm:inline">{customer.name}</span>
            <button
              onClick={() => void handleLogout()}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              <LogoutIcon className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold text-gray-900">Hi, {customer.name.split(" ")[0]}</h1>
        <p className="mt-1 text-sm text-gray-500">
          Account <span className="font-mono font-medium text-gray-700">{customer.ban}</span> · {customer.planName}
        </p>

        {pastDue && (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
            <strong>{formatMoney(customer.pastDueAmount)} is past due.</strong> Call us to pay now or set up a payment arrangement.
          </div>
        )}

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <section className="rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 p-6 text-white shadow-sm lg:col-span-2">
            <p className="text-sm text-blue-100">Current balance</p>
            <p className="mt-1 text-4xl font-bold tabular-nums">{formatMoney(customer.currentBalance)}</p>
            <p className="mt-2 text-sm text-blue-100">
              {customer.currentBalance <= 0
                ? "You're all paid up."
                : customer.nextBillingDueDate
                  ? `Due ${formatDateOnly(customer.nextBillingDueDate)}`
                  : "No due date scheduled yet."}
              {customer.autopayEnabled && customer.currentBalance > 0 ? " · Autopay will cover it." : ""}
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-white/15 px-3 py-1">Autopay {customer.autopayEnabled ? "on" : "off"}</span>
              {customer.discountPercent > 0 && <span className="rounded-full bg-white/15 px-3 py-1">{customer.discountPercent}% discount applied</span>}
              <span className="rounded-full bg-white/15 px-3 py-1">Account {customer.accountStatus.toLowerCase().replace("_", " ")}</span>
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <PhoneIcon className="h-4 w-4 text-blue-600" /> Need help?
            </p>
            <p className="mt-2 text-sm text-gray-600">
              Call {activity?.careLineNumber ? <span className="font-semibold text-gray-900 tabular-nums">{activity.careLineNumber}</span> : "our care line"} any time.{" "}
              {activity?.assistantName ?? "Our assistant"} can take a payment, change your plan, book a technician or set up a callback.
            </p>
            <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
              Have your account number <span className="font-mono font-semibold text-gray-800">{customer.ban}</span> and your 4-digit PIN ready.
            </p>
          </section>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Fact label="Plan" value={customer.planName} />
          <Fact label="Last payment" value={customer.lastPaymentDate ? formatMoney(customer.lastPaymentAmount) : "—"} hint={customer.lastPaymentDate ? formatDateOnly(customer.lastPaymentDate) : "No payments yet"} />
          <Fact label="Next bill" value={customer.nextBillingDueDate ? formatDateOnly(customer.nextBillingDueDate) : "—"} />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <CalendarIcon className="h-4 w-4 text-blue-600" /> Coming up
            </h2>
            {!activity ? (
              <p className="mt-3 text-sm text-gray-400">Loading…</p>
            ) : activity.upcoming.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">Nothing scheduled. Callbacks, technician visits and payment arrangements you book by phone show up here.</p>
            ) : (
              <ul className="mt-3 divide-y divide-gray-100">
                {activity.upcoming.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 py-3 text-sm">
                    <span>
                      <span className="font-medium text-gray-900">{ACTION_LABELS[a.type]}</span>
                      <span className="block text-gray-500">{upcomingText(a)}</span>
                    </span>
                    <Badge tone="info">{formatDateOnly(a.scheduledFor)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <CheckIcon className="h-4 w-4 text-green-600" /> Recent activity
            </h2>
            {!activity ? (
              <p className="mt-3 text-sm text-gray-400">Loading…</p>
            ) : activity.history.length === 0 && activity.recentCalls.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">No recent activity.</p>
            ) : (
              <ul className="mt-3 divide-y divide-gray-100 text-sm">
                {activity.history.map((a) => (
                  <li key={`a${a.id}`} className="flex justify-between gap-3 py-3">
                    <span className="text-gray-800">{a.description}</span>
                    <span className="shrink-0 text-gray-400">{formatDateOnly(a.createdAt)}</span>
                  </li>
                ))}
                {activity.recentCalls.map((c) => (
                  <li key={c.id} className="flex justify-between gap-3 py-3">
                    <span className="text-gray-800">{callSummary(c.intent)}</span>
                    <span className="shrink-0 text-gray-400">{formatDateTime(c.startTime)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

// Plain-language line for a past call, as the customer would describe it.
function callSummary(intent: CustomerActivity["recentCalls"][number]["intent"]): string {
  const about: Partial<Record<NonNullable<typeof intent>, string>> = {
    CHECK_BALANCE: "your balance",
    MAKE_PAYMENT: "a payment",
    PAYMENT_HISTORY: "a past payment",
    BILLING_DUE_DATE: "your due date",
    PAYMENT_PROMISE: "a payment arrangement",
    PLAN_INFO: "your plan",
    PLAN_CHANGE: "changing your plan",
    AUTOPAY_STATUS: "autopay",
    OUTAGE_CHECK: "a service outage",
    TECH_TRIAGE: "a technical problem",
    SCHEDULE_TECH: "a technician visit",
    SCHEDULE_CALLBACK: "a callback",
  };
  return `You called about ${(intent && about[intent]) || "your account"}`;
}

function upcomingText(a: CustomerActivity["upcoming"][number]): string {
  if (a.type === "TECH_VISIT") return `Technician visit${a.window ? `, ${a.window}` : ""}`;
  if (a.type === "CALLBACK") return `We'll call you${a.window ? ` in the ${a.window}` : ""}`;
  return a.description;
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1.5 text-lg font-semibold text-gray-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
