"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { customerMe, customerActivity, fetchCustomerPlans, purchasePlan, logout, type CustomerAccount, type CustomerActivity, type PlanInfo } from "../../../lib/api";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { CustomerCallWidget } from "../../../components/CustomerCallWidget";
import { LogoMark, PhoneIcon, LogoutIcon, HeadsetIcon, WaveformIcon, CheckIcon, UsersIcon } from "../../../components/icons";
import { formatMoney } from "../../../lib/format";

const FEATURES = [
  { icon: WaveformIcon, title: "Speeds up to 1 Gig", body: "Fiber-fast downloads and uploads for every device, at home or in the office, no slowdowns at peak hours." },
  { icon: HeadsetIcon, title: "24/7 automated support", body: "Call any time, day or night, and get help in seconds - a live agent is always one ask away." },
  { icon: CheckIcon, title: "No contracts, no surprises", body: "Simple monthly pricing, cancel any time. No hidden fees, no early-termination charges." },
  { icon: UsersIcon, title: "Local technicians", body: "Need a hand at home or on-site at your business? We'll get someone out to you, usually within the week." },
];

// Illustrative trust-signal numbers for the demo (Springfield Fiber is a fictional company - not
// pulled from any real filing), styled after the quick stats strip on fidiumfiber.com.
const STATS = [
  { value: "50K+", label: "Homes & businesses connected" },
  { value: "1 Gig", label: "Max download speed" },
  { value: "24/7", label: "Always-on support" },
  { value: "99.9%", label: "Network uptime" },
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
  const [planAudience, setPlanAudience] = useState<"RESIDENTIAL" | "BUSINESS">("RESIDENTIAL");

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
              by fidiumfiber.com's split hero-with-photo, not copied). Light background, not the dark
              nav's black (found and fixed Sep 30 - a solid-black hero directly under the equally-black
              header read as one oversized, undifferentiated black slab, flagged as unprofessional).
              Also standardized on the same max-w-4xl the header and every section below already use -
              this used to be max-w-6xl (and the stats band below was max-w-5xl), so the hero and stats
              content never actually lined up with the header logo or the page content under them. */}
          <section className="relative overflow-hidden bg-white">
            <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-brand-50" aria-hidden="true" />
            <div className="relative mx-auto grid max-w-4xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:items-center lg:py-16">
              <div className="text-center lg:text-left">
                <span className="kicker text-brand-600">Welcome, {customer.name.split(" ")[0]}</span>
                <h1 className="mt-3 text-3xl font-bold leading-tight text-gray-900 sm:text-4xl">
                  Fiber internet built for <span className="text-brand-600">your home or business.</span>
                </h1>
                <p className="mx-auto mt-4 max-w-xl text-gray-600 lg:mx-0">
                  Springfield Fiber keeps homes and businesses connected with fast, reliable internet and support that actually picks up. Take a look at
                  what we offer, then choose a plan whenever you're ready.
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
                  className="relative aspect-[4/3] w-full rounded-2xl object-cover shadow-xl ring-1 ring-gray-900/5"
                />
              </div>
            </div>
          </section>

          {/* Stats band - quick trust signals, styled after Fidium's stats strip */}
          <section className="border-y border-gray-200 bg-slate-50">
            <div className="mx-auto grid max-w-4xl grid-cols-2 gap-6 px-4 py-8 sm:px-6 lg:grid-cols-4 lg:gap-4">
              {STATS.map((s) => (
                <div key={s.label} className="text-center">
                  <p className="text-2xl font-bold text-brand-600 sm:text-3xl">{s.value}</p>
                  <p className="mt-1 text-xs text-gray-500 sm:text-sm">{s.label}</p>
                </div>
              ))}
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

            {/* Connected everywhere - a second real photo, feature-with-photo band (Fidium-style) */}
            <section className="mt-12 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="grid gap-0 sm:grid-cols-2 sm:items-center">
                <img
                  src="https://images.unsplash.com/photo-1620862657788-a403bdf6dd63?w=900&q=80&auto=format&fit=crop"
                  alt="A woman relaxing on her couch, working on a laptop over wifi at home"
                  className="h-56 w-full object-cover sm:h-full"
                />
                <div className="p-6 sm:p-8">
                  <span className="kicker">Wifi built to keep up</span>
                  <h2 className="mt-2 text-lg font-bold text-gray-900">Work, stream, and connect without the dead zones</h2>
                  <p className="mt-2 text-sm text-gray-600">
                    Reliable coverage from wall to wall, whether it's a home office, a full house, or a small business floor.
                  </p>
                  <ul className="mt-4 space-y-2 text-sm text-gray-600">
                    <li className="flex items-start gap-2">
                      <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> Free wifi router included with every plan
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> Set up the same day service is installed
                    </li>
                  </ul>
                </div>
              </div>
            </section>

            {/* Plans - residential and business are shown as two distinct groups (found and fixed
                Sep 30: this used to be one flat list with no business-tier plans at all, so a
                business prospect was quietly offered the same catalog as a home customer). Picking
                a business plan here is also what tags the new account BUSINESS server-side. */}
            <section id="plans" className="mt-12 scroll-mt-6">
              <span className="kicker">Plans</span>
              <h2 className="mt-2 text-lg font-bold text-gray-900">Choose a plan to get started</h2>
              <p className="mt-2 max-w-2xl text-sm text-gray-600">
                Pick a plan to activate your service. You'll get an account number and an account PIN right away, so you can start using your account and
                calling in for support immediately.
              </p>
              {error && <p className="mt-3 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}

              <div className="mt-5 inline-flex rounded-full border border-gray-200 bg-white p-1">
                {(["RESIDENTIAL", "BUSINESS"] as const).map((a) => (
                  <button
                    key={a}
                    onClick={() => setPlanAudience(a)}
                    className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                      planAudience === a ? "bg-brand-600 text-white" : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    {a === "RESIDENTIAL" ? "For your home" : "For your business"}
                  </button>
                ))}
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {!plans ? (
                  <p className="text-sm text-gray-400">Loading plans…</p>
                ) : (
                  plans
                    .filter((plan) => plan.audience === planAudience)
                    .map((plan) => (
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
