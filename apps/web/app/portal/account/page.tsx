"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  logout,
  customerMe,
  customerActivity,
  fetchCustomerPlans,
  switchPlan,
  type CustomerAccount,
  type CustomerActivity,
  type PlanInfo,
} from "../../../lib/api";
import { Badge } from "../../../components/Badge";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { CustomerCallWidget } from "../../../components/CustomerCallWidget";
import { FaqAccordion } from "../../../components/FaqAccordion";
import { PLAN_BADGES } from "../../../lib/marketingContent";
import { LogoMark, PhoneIcon, CalendarIcon, CheckIcon, LogoutIcon, HeadsetIcon, ArrowRightIcon } from "../../../components/icons";
import { ACTION_LABELS, formatDateOnly, formatDateTime, formatMoney } from "../../../lib/format";

const FAQS: { q: string; a: string }[] = [
  {
    q: "What do I need on hand when I call?",
    a: "Your account number and your 4-digit account PIN, the ones you were given when you signed up for service. Our assistant verifies you with these before sharing any account details.",
  },
  {
    q: "What can the automated assistant help with?",
    a: "Checking your balance, making a payment, your last payment or next due date, plan details and changes, payment arrangements, outage checks, booking a technician, and scheduling a callback.",
  },
  {
    q: "Can I speak to a live agent instead?",
    a: "Yes. Just ask at any point in the call, and the assistant will transfer you with a summary of what you've already told it, so you don't have to repeat yourself.",
  },
  {
    q: "Is the call recorded?",
    a: "Yes, for quality and training, unless recording has been switched off for this deployment. The assistant always tells you at the start of the call.",
  },
];

// Customer self-service portal: everything about the account (balance, plan, payments, upcoming
// bookings) plus a way to upgrade the plan and reach customer support, all on one page (user
// request — no separate marketing site, no separate support page).
export default function PortalAccountPage() {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerAccount | null>(null);
  const [activity, setActivity] = useState<CustomerActivity | null>(null);
  const [plans, setPlans] = useState<PlanInfo[] | null>(null);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [switchTarget, setSwitchTarget] = useState<PlanInfo | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchNote, setSwitchNote] = useState<string | null>(null);

  useEffect(() => {
    customerMe()
      .then(({ customer }) => {
        if (customer.accountStatus === "PROSPECT") {
          router.replace("/portal/get-started");
          return;
        }
        setCustomer(customer);
        return Promise.all([customerActivity().then(setActivity), fetchCustomerPlans().then(({ plans }) => setPlans(plans))]);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  async function handleConfirmSwitch() {
    if (!switchTarget) return;
    setSwitching(true);
    setSwitchError(null);
    try {
      const result = await switchPlan(switchTarget.name);
      setCustomer((c) => (c ? { ...c, planName: result.planName, currentBalance: result.newBalance } : c));
      setSwitchNote(
        result.charged > 0
          ? `You're now on ${result.planName}. We've added ${formatMoney(result.charged)} to your balance for the upgrade.`
          : `You're now on ${result.planName}.`
      );
      setSwitchTarget(null);
    } catch {
      setSwitchError("Couldn't switch your plan just now. Please try again.");
    } finally {
      setSwitching(false);
    }
  }

  if (!customer) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-gray-400">Loading…</div>;
  }

  const brand = activity?.brandName ?? "Springfield Fiber";
  const pastDue = customer.pastDueAmount > 0;
  const currentPlan = plans?.find((p) => p.name.toLowerCase() === customer.planName.toLowerCase());

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-ink-950">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <span className="flex items-center gap-2">
            <LogoMark className="h-7 w-7" />
            <span className="text-lg font-bold text-white">{brand}</span>
          </span>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-gray-300 sm:inline">{customer.name}</span>
            <a href="#support" className="btn whitespace-nowrap border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white hover:bg-white/10">
              <HeadsetIcon className="h-4 w-4" />
              Support
            </a>
            <button onClick={() => setConfirmingLogout(true)} className="btn whitespace-nowrap border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white hover:bg-white/10">
              <LogoutIcon className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
        <ConfirmDialog
          open={confirmingLogout}
          title="Sign out?"
          message="You'll need to sign in again to get back to your account."
          confirmLabel="Sign out"
          onConfirm={() => void handleLogout()}
          onCancel={() => setConfirmingLogout(false)}
        />
        <div className="h-[3px] bg-brand-600" />
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <span className="kicker">Your account</span>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Hi, {customer.name.split(" ")[0]}</h1>
        <p className="mt-1 text-sm text-gray-500">
          Account <span className="font-mono font-medium text-gray-700">{customer.ban.replace(/^BAN/, "")}</span> · {customer.planName}
        </p>

        {pastDue && (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
            <strong>{formatMoney(customer.pastDueAmount)} is past due.</strong> Call us to pay now or set up a payment arrangement.
          </div>
        )}

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <section className="rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-6 text-white shadow-sm lg:col-span-2">
            <p className="text-sm text-brand-100">Current balance</p>
            <p className="mt-1 text-4xl font-bold tabular-nums">{formatMoney(customer.currentBalance)}</p>
            <p className="mt-2 text-sm text-brand-100">
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
            <p className="text-sm font-semibold text-gray-900">Current plan</p>
            <p className="mt-1 text-2xl font-bold text-brand-600">{customer.planName}</p>
            {currentPlan && <p className="mt-1 text-sm text-gray-600">{formatMoney(currentPlan.monthlyPrice)}/mo · {currentPlan.description}</p>}
            <a href="#plans" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700">
              See all plans <ArrowRightIcon className="h-3.5 w-3.5" />
            </a>
          </section>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Fact label="Plan" value={customer.planName} />
          <Fact
            label="Last payment"
            value={customer.lastPaymentDate ? formatMoney(customer.lastPaymentAmount) : "-"}
            hint={customer.lastPaymentDate ? formatDateOnly(customer.lastPaymentDate) : "No payments yet"}
          />
          <Fact label="Next bill" value={customer.nextBillingDueDate ? formatDateOnly(customer.nextBillingDueDate) : "-"} />
        </div>

        {/* Plans / upgrade - scoped to the customer's own account type (residential or business are
            separate product lines, see PLAN_CATALOG; a residential account never sees business plans
            here, matching what the phone PLAN_CHANGE flow would actually offer, and vice versa).
            Self-service switch on the existing session, no re-auth (user request, Sep 30: "while
            switching the plan they dont have to sign in again or signup again") - the balance carries
            over and an upgrade adds the price difference on top (fake proration, same logic the phone
            PLAN_CHANGE subflow uses - see businessLogic.ts::applyPlanChange). */}
        <section id="plans" className="mt-8">
          <span className="kicker">Plans</span>
          <h2 className="mt-2 text-lg font-bold text-gray-900">Available plans</h2>
          <p className="mt-1 text-sm text-gray-500">Switch any time - no need to sign in again. Upgrading adds the price difference to your balance.</p>
          {switchNote && <p className="mt-3 rounded-lg bg-green-50 px-3.5 py-2.5 text-sm text-green-700">{switchNote}</p>}
          {switchError && <p className="mt-3 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{switchError}</p>}
          {!plans ? (
            <p className="mt-4 text-sm text-gray-400">Loading…</p>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {plans.filter((p) => p.audience === customer.customerType).map((p) => {
                const isCurrent = p.name.toLowerCase() === customer.planName.toLowerCase();
                return (
                  <div
                    key={p.name}
                    className={`rounded-2xl border bg-white p-5 shadow-sm ${isCurrent ? "border-brand-600 ring-2 ring-brand-600/20" : "border-gray-200"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-gray-900">{p.name}</p>
                      {isCurrent ? <Badge tone="success">Current plan</Badge> : PLAN_BADGES[p.name] ? <Badge tone="info">{PLAN_BADGES[p.name]}</Badge> : null}
                    </div>
                    <p className="mt-1 text-xl font-bold text-brand-600">{formatMoney(p.monthlyPrice)}<span className="text-sm font-medium text-gray-500">/mo</span></p>
                    <p className="mt-1 text-sm text-gray-600">{p.description}</p>
                    {!isCurrent && (
                      <button onClick={() => setSwitchTarget(p)} className="btn btn-secondary mt-3 w-full px-3 py-2 text-sm">
                        Switch to this plan
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <ConfirmDialog
          open={switchTarget !== null}
          title={`Switch to ${switchTarget?.name}?`}
          message={
            switchTarget && currentPlan
              ? Math.max(0, switchTarget.monthlyPrice - currentPlan.monthlyPrice) > 0
                ? `This adds ${formatMoney(Math.max(0, switchTarget.monthlyPrice - currentPlan.monthlyPrice))} to your balance for the upgrade, starting with your next bill.`
                : `Your balance carries over as-is - no extra charge for this switch.`
              : "Your balance carries over to the new plan."
          }
          confirmLabel={switching ? "Switching…" : "Switch plan"}
          onConfirm={() => void handleConfirmSwitch()}
          onCancel={() => setSwitchTarget(null)}
        />

        <div className="mt-8 grid items-start gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <CalendarIcon className="h-4 w-4 text-brand-600" /> Coming up
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

        {/* Customer support — the only place the care-line number appears, per user direction. */}
        <section id="support" className="mt-8 scroll-mt-6">
          <span className="kicker">Customer support</span>
          <h2 className="mt-2 text-lg font-bold text-gray-900">Need help, {customer.name.split(" ")[0]}?</h2>

          <div className="mt-4 rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-6 text-white shadow-sm sm:p-8">
            <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-white/80">
              <PhoneIcon className="h-4 w-4" /> Call customer care
            </p>
            <CustomerCallWidget careLineNumber={activity?.careLineNumber ?? null} />
            <p className="mt-3 max-w-lg text-sm text-white/85">
              Available any time. {activity?.assistantName ?? "Our assistant"} answers first and can check your balance, take a payment,
              change your plan, book a technician or set up a callback. Ask for a live agent at any point and it'll transfer you with full
              context.
            </p>
            <p className="mt-3 rounded-lg bg-white/10 px-3 py-2 text-xs text-white/85">
              Have your account number <span className="font-mono font-semibold">{customer.ban.replace(/^BAN/, "")}</span> and your 4-digit PIN ready.
            </p>
          </div>

          <div className="mt-6">
            <FaqAccordion faqs={FAQS} />
          </div>
        </section>
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
