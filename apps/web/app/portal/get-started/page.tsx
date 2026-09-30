"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { customerMe, customerActivity, fetchCustomerPlans, purchasePlan, logout, type CustomerAccount, type CustomerActivity, type PlanInfo } from "../../../lib/api";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { CustomerCallWidget } from "../../../components/CustomerCallWidget";
import { LogoMark, PhoneIcon, LogoutIcon, HeadsetIcon, WaveformIcon, CheckIcon, UsersIcon } from "../../../components/icons";
import { formatMoney } from "../../../lib/format";

const FEATURES = [
  { icon: WaveformIcon, title: "Speeds up to 1 Gig", body: "Fiber-fast downloads and uploads for every device in the house, no slowdowns at peak hours." },
  { icon: HeadsetIcon, title: "24/7 automated support", body: "Call any time, day or night, and get help in seconds - a live agent is always one ask away." },
  { icon: CheckIcon, title: "No contracts, no surprises", body: "Simple monthly pricing, cancel any time. No hidden fees, no early-termination charges." },
  { icon: UsersIcon, title: "Local technicians", body: "Need a hand at home? We'll get someone out to you, usually within the week." },
];

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

      {purchased ? (
        <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
          <section className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center">
            <p className="text-sm font-semibold uppercase tracking-wide text-green-700">You're all set</p>
            <h1 className="mt-2 text-2xl font-bold text-gray-900">Welcome to {purchased.planName}, {customer.name.split(" ")[0]}!</h1>
            <p className="mx-auto mt-3 max-w-md text-sm text-gray-600">
              Save these. You'll need them any time you call our care line. You won't be shown this PIN again.
            </p>
            <div className="mx-auto mt-6 flex max-w-sm flex-col gap-3 sm:flex-row">
              <div className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Account number</p>
                <p className="mt-1 font-mono text-lg font-bold text-gray-900">{purchased.ban.replace(/^BAN/, "")}</p>
              </div>
              <div className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Account PIN</p>
                <p className="mt-1 font-mono text-lg font-bold text-gray-900">{purchased.pin}</p>
              </div>
            </div>
            <button onClick={() => router.push("/portal/account")} className="btn btn-primary mt-8 px-6 py-2.5 text-sm">
              Go to my account
            </button>
          </section>
        </main>
      ) : (
        <>
          {/* Hero — a normal commercial-site landing, not a pricing table up front (user request:
              "we should not directly throw all the plans in their face"; structure loosely inspired
              by fidiumfiber.com's split hero-with-photo, not copied). */}
          <section className="relative overflow-hidden bg-ink-950 text-white">
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.06]"
              style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "22px 22px" }}
              aria-hidden="true"
            />
            <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-600/20" />
            <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center lg:py-20">
              <div className="text-center lg:text-left">
                <span className="kicker text-brand-500">Welcome, {customer.name.split(" ")[0]}</span>
                <h1 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">
                  Fiber internet built for <span className="text-brand-500">your home.</span>
                </h1>
                <p className="mx-auto mt-4 max-w-xl text-gray-400 lg:mx-0">
                  Springfield Fiber keeps you connected with fast, reliable internet and support that actually picks up. Take a look at what we offer,
                  then choose a plan whenever you're ready.
                </p>
                <a href="#plans" className="btn btn-primary mt-7 inline-flex px-6 py-2.5 text-sm">
                  View plans
                </a>
              </div>
              <div className="relative">
                <div className="pointer-events-none absolute -inset-4 rounded-[2rem] bg-brand-600/10 blur-2xl" aria-hidden="true" />
                <img
                  src="https://images.unsplash.com/photo-1758687125866-6b9d86d41cc5?w=1000&q=80&auto=format&fit=crop"
                  alt="A father and son relaxing on the couch, streaming a show together at home"
                  className="relative aspect-[4/3] w-full rounded-2xl object-cover shadow-2xl ring-1 ring-white/10"
                />
              </div>
            </div>
          </section>

          <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
            {/* Why us */}
            <section>
              <span className="kicker">Why Springfield Fiber</span>
              <h2 className="mt-2 text-lg font-bold text-gray-900">Everything you'd expect, nothing you wouldn't</h2>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                {FEATURES.map(({ icon: Icon, title, body }) => (
                  <div key={title} className="flex gap-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="font-semibold text-gray-900">{title}</p>
                      <p className="mt-1 text-sm text-gray-500">{body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Plans */}
            <section id="plans" className="mt-12 scroll-mt-6">
              <span className="kicker">Plans</span>
              <h2 className="mt-2 text-lg font-bold text-gray-900">Choose a plan to get started</h2>
              <p className="mt-2 max-w-2xl text-sm text-gray-600">
                Pick a plan to activate your service. You'll get an account number and an account PIN right away, so you can start using your account and
                calling in for support immediately.
              </p>
              {error && <p className="mt-3 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}

              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
              </div>
            </section>

            {/* Support */}
            <section className="mt-12">
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
          </main>
        </>
      )}
    </div>
  );
}
