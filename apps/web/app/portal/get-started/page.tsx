"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { customerMe, customerActivity, fetchCustomerPlans, purchasePlan, logout, type CustomerAccount, type CustomerActivity, type PlanInfo } from "../../../lib/api";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { CustomerCallWidget } from "../../../components/CustomerCallWidget";
import { LogoMark, PhoneIcon, LogoutIcon, HeadsetIcon } from "../../../components/icons";
import { formatMoney } from "../../../lib/format";

// Landing page for a customer who has a web login but hasn't bought a plan yet (account_status =
// PROSPECT) - a real customer (has an active plan) is redirected straight past this to
// /portal/account instead. Picking a plan here is what actually makes them a customer: it assigns a
// real BAN and a phone PIN (shown once, immediately below), same simulated-purchase pattern as
// MAKE_PAYMENT on a call - no real payment gateway exists in this POC.
export default function GetStartedPage() {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerAccount | null>(null);
  const [activity, setActivity] = useState<CustomerActivity | null>(null);
  const [plans, setPlans] = useState<PlanInfo[] | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [purchased, setPurchased] = useState<{ ban: string; pin: string; planName: string } | null>(null);
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  useEffect(() => {
    customerMe()
      .then(({ customer }) => {
        if (customer.accountStatus !== "PROSPECT") {
          router.replace("/portal/account");
          return;
        }
        setCustomer(customer);
        // careLineNumber comes back on /activity even for a prospect (no account data in it depends
        // on an active plan) - reused here just for the number and brand/assistant names.
        return fetchCustomerPlans().then(({ plans }) => setPlans(plans));
      })
      .then(() => customerActivity().then(setActivity).catch(() => {}))
      .catch(() => router.replace("/login"));
  }, [router]);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  async function handleBuy(planName: string) {
    setBuying(planName);
    setError(null);
    try {
      const result = await purchasePlan(planName);
      setPurchased(result);
    } catch {
      setError("Couldn't complete that just now. Please try again.");
    } finally {
      setBuying(null);
    }
  }

  if (!customer) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-gray-400">Loading…</div>;
  }

  const brand = activity?.brandName ?? "Springfield Fiber";

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
            <button onClick={() => setConfirmingLogout(true)} className="btn whitespace-nowrap border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white hover:bg-white/10">
              <LogoutIcon className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
        <ConfirmDialog
          open={confirmingLogout}
          title="Sign out?"
          message="You'll need to sign in again to finish setting up your account."
          confirmLabel="Sign out"
          onConfirm={() => void handleLogout()}
          onCancel={() => setConfirmingLogout(false)}
        />
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {purchased ? (
          <section className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center">
            <p className="text-sm font-semibold uppercase tracking-wide text-green-700">You're all set</p>
            <h1 className="mt-2 text-2xl font-bold text-gray-900">Welcome to {purchased.planName}, {customer.name.split(" ")[0]}!</h1>
            <p className="mx-auto mt-3 max-w-md text-sm text-gray-600">
              Save these — you'll need them any time you call our care line. You won't be shown this PIN again.
            </p>
            <div className="mx-auto mt-6 flex max-w-sm flex-col gap-3 sm:flex-row">
              <div className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Account number</p>
                <p className="mt-1 font-mono text-lg font-bold text-gray-900">{purchased.ban}</p>
              </div>
              <div className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Phone PIN</p>
                <p className="mt-1 font-mono text-lg font-bold text-gray-900">{purchased.pin}</p>
              </div>
            </div>
            <button onClick={() => router.push("/portal/account")} className="btn btn-primary mt-8 px-6 py-2.5 text-sm">
              Go to my account
            </button>
          </section>
        ) : (
          <>
            <section>
              <span className="kicker">Get started</span>
              <h1 className="mt-2 text-2xl font-bold text-gray-900">Welcome, {customer.name.split(" ")[0]} — choose a plan</h1>
              <p className="mt-2 max-w-2xl text-sm text-gray-600">
                Pick a plan to activate your service. You'll get an account number and a phone PIN right away, so you can start using your account
                and calling in for support immediately.
              </p>
              {error && <p className="mt-3 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}
            </section>

            <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {!plans ? (
                <p className="text-sm text-gray-400">Loading plans…</p>
              ) : (
                plans.map((plan) => (
                  <div key={plan.name} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                    <p className="font-semibold text-gray-900">{plan.name}</p>
                    <p className="mt-1 text-2xl font-bold text-brand-600">
                      {formatMoney(plan.monthlyPrice)}
                      <span className="text-sm font-normal text-gray-500">/mo</span>
                    </p>
                    <p className="mt-1 text-sm text-gray-500">{plan.description}</p>
                    <button
                      onClick={() => void handleBuy(plan.name)}
                      disabled={buying !== null}
                      className="btn btn-primary mt-4 w-full py-2 text-sm disabled:opacity-50"
                    >
                      {buying === plan.name ? "Setting up…" : "Choose this plan"}
                    </button>
                  </div>
                ))
              )}
            </section>

            <section className="mt-10">
              <span className="kicker">Prefer to talk it through?</span>
              <h2 className="mt-2 text-lg font-bold text-gray-900">Call customer support</h2>
              <div className="mt-4 rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-6 text-white shadow-sm sm:p-8">
                <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-white/80">
                  <PhoneIcon className="h-4 w-4" /> Call customer care
                </p>
                <CustomerCallWidget careLineNumber={activity?.careLineNumber ?? null} />
                <p className="mt-3 max-w-lg text-sm text-white/85">
                  <HeadsetIcon className="mr-1 inline h-4 w-4 align-text-bottom" />
                  Our assistant can check service availability in your area and get you signed up right over the phone, no plan choice needed here.
                </p>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
