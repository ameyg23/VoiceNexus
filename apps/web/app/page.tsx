"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchDemoConfig, fetchPublicPlans, checkPublicAvailability, type DemoConfig, type PlanInfo } from "../lib/api";
import { PLAN_BADGES, GET_STARTED_FAQS } from "../lib/marketingContent";
import { MarketingSections } from "../components/MarketingSections";
import { FaqAccordion } from "../components/FaqAccordion";
import { LogoMark, PhoneIcon, HeadsetIcon } from "../components/icons";
import { formatMoney } from "../lib/format";

// Public commercial homepage - no login required (user request, Sep 30: "when we open the website
// we should see the commercial company page, then after clicking on my account the login page
// should open"). Supersedes the old "/" -> /login redirect in next.config.mjs. This is deliberately
// the third time this exact structure has been tried this week (see CLAUDE.md's Sep 29 "reverted to
// no-public-site" entry) - the difference this time is the request was explicit and unambiguous,
// not inferred from an aside.
//
// Shares its marketing content with /portal/get-started (MarketingSections, marketingContent.ts) -
// the two pages differ only in what happens after "Choose this plan": a signed-in prospect there
// purchases directly, an anonymous visitor here is sent to /signup?plan=<name>, which creates the
// account and purchases the plan in one step (user request, same day: "instead of a sign up page,
// once they click on any plans... we will get their details"). Also can't use the customer-auth-gated
// plans/availability endpoints or CustomerCallWidget (no session yet) - uses the public /api/demo/*
// equivalents and a plain tel: link instead.
export default function HomePage() {
  const router = useRouter();
  const [config, setConfig] = useState<DemoConfig | null>(null);
  const [plans, setPlans] = useState<PlanInfo[] | null>(null);
  const [planAudience, setPlanAudience] = useState<"RESIDENTIAL" | "BUSINESS">("RESIDENTIAL");
  const [zipInput, setZipInput] = useState("");
  const [checkingZip, setCheckingZip] = useState(false);
  const [zipResult, setZipResult] = useState<{ zip: string; available: boolean } | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);

  useEffect(() => {
    fetchDemoConfig().then(setConfig).catch(() => {});
    fetchPublicPlans().then(setPlans).catch(() => {});
  }, []);

  async function handleCheckAvailability(e: React.FormEvent) {
    e.preventDefault();
    setCheckingZip(true);
    setZipError(null);
    setZipResult(null);
    try {
      const result = await checkPublicAvailability(zipInput, planAudience);
      setZipResult({ zip: result.zip, available: result.available });
    } catch {
      setZipError("Couldn't check that ZIP code just now. Please try again.");
    } finally {
      setCheckingZip(false);
    }
  }

  const brand = config?.brandName ?? "Springfield Fiber";
  const careLine = config?.careLineNumber ?? null;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-ink-950">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <span className="flex items-center gap-2">
            <LogoMark className="h-7 w-7" />
            <span className="text-lg font-bold text-white">{brand}</span>
          </span>
          <div className="flex items-center gap-8">
            <nav className="hidden items-center gap-6 sm:flex">
              <a href="#plans" className="text-sm font-medium text-gray-300 hover:text-white">
                Plans
              </a>
              <a href="#support" className="text-sm font-medium text-gray-300 hover:text-white">
                Support
              </a>
            </nav>
            <div className="flex items-center gap-3">
              <a href="/login" className="text-sm font-medium text-gray-300 hover:text-white">
                My account
              </a>
              <a href="#plans" className="btn btn-primary px-4 py-1.5 text-sm">
                Get started
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* Promo banner */}
      <div className="border-b border-amber-200 bg-amber-50">
        <p className="mx-auto max-w-7xl px-4 py-2.5 text-center text-sm font-medium text-amber-900 sm:px-6">
          New customer offer: free professional installation on every plan, no exceptions.
        </p>
      </div>

      {/* Hero - generic, no "Welcome, {name}" personalization since the visitor isn't signed in. */}
      <section className="relative overflow-hidden bg-white">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-brand-50" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:items-center lg:py-16">
          <div className="text-center lg:text-left">
            <span className="kicker text-brand-600">Springfield Fiber</span>
            <h1 className="mt-3 text-3xl font-bold leading-tight text-gray-900 sm:text-4xl">
              Fiber internet built for <span className="text-brand-600">your home or business.</span>
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-gray-600 lg:mx-0">
              Springfield Fiber keeps homes and businesses connected with fast, reliable internet and support that actually picks up. Take a look at
              what we offer, then get started whenever you're ready.
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

      <MarketingSections />

      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        {/* Plans - "Choose this plan" sends an anonymous visitor to /signup?plan=<name>, which
            creates the account and purchases the plan in one step. */}
        <section id="plans" className="scroll-mt-6">
          <span className="kicker">Plans</span>
          <h2 className="mt-2 text-lg font-bold text-gray-900">Choose a plan to get started</h2>
          <p className="mt-2 max-w-2xl text-sm text-gray-600">
            Pick a plan and create your account in one step. You'll get an account number and an account PIN right away, so you can start using your
            account and calling in for support immediately.
          </p>

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

          {planAudience === "RESIDENTIAL" ? (
            <p className="mt-4 rounded-lg bg-brand-50 px-4 py-2.5 text-sm text-brand-800">
              Bundle and save: add TV to Fiber 500 or Fiber 1000 and pay $5/mo less than buying internet and TV separately.
            </p>
          ) : (
            <p className="mt-4 rounded-lg bg-brand-50 px-4 py-2.5 text-sm text-brand-800">
              Every business plan includes a static IP and priority support, already built into the price below - no add-on fees.
            </p>
          )}

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {!plans ? (
              <p className="text-sm text-gray-400">Loading plans…</p>
            ) : (
              plans
                .filter((plan) => plan.audience === planAudience)
                .map((plan) => (
                  <div key={plan.name} className={`relative rounded-2xl border bg-white p-5 shadow-sm ${PLAN_BADGES[plan.name] ? "border-brand-300" : "border-gray-200"}`}>
                    {PLAN_BADGES[plan.name] && (
                      <span className="absolute -top-3 left-4 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white shadow-sm">
                        {PLAN_BADGES[plan.name]}
                      </span>
                    )}
                    <p className="font-semibold text-gray-900">{plan.name}</p>
                    <p className="mt-1 text-2xl font-bold text-brand-600">
                      {formatMoney(plan.monthlyPrice)}
                      <span className="text-sm font-normal text-gray-500">/mo</span>
                    </p>
                    <p className="mt-1 text-sm text-gray-500">{plan.description}</p>
                    <button
                      onClick={() => router.push(`/signup?plan=${encodeURIComponent(plan.name)}`)}
                      className="btn btn-primary mt-4 w-full py-2 text-sm"
                    >
                      Get started
                    </button>
                  </div>
                ))
            )}
          </div>
        </section>

        {/* Check availability - public equivalent of the get-started page's checker (same
            service_areas data, exposed via /api/demo/service-availability, no login needed). */}
        <section className="mt-12 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
          <span className="kicker">Ready to see if we're in your area?</span>
          <h2 className="mt-2 text-lg font-bold text-gray-900">Check availability by ZIP code</h2>
          <p className="mt-1 text-sm text-gray-600">
            We'll check {planAudience === "BUSINESS" ? "business" : "residential"} coverage right away, no call needed.
          </p>
          <form onSubmit={(e) => void handleCheckAvailability(e)} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              value={zipInput}
              onChange={(e) => {
                setZipInput(e.target.value.replace(/\D/g, "").slice(0, 5));
                setZipResult(null);
              }}
              placeholder="Enter your ZIP code"
              inputMode="numeric"
              aria-label="ZIP code"
              className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:max-w-xs"
            />
            <button type="submit" disabled={zipInput.length !== 5 || checkingZip} className="btn btn-primary px-6 py-2.5 text-sm disabled:opacity-50">
              {checkingZip ? "Checking…" : "Check availability"}
            </button>
          </form>
          {zipError && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{zipError}</p>}
          {zipResult && (
            <p className={`mt-4 rounded-lg px-4 py-3 text-sm ${zipResult.available ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>
              {zipResult.available
                ? `Good news! Springfield Fiber ${planAudience === "BUSINESS" ? "business" : "residential"} service is available in ${zipResult.zip}. Pick a plan above to get started.`
                : `We're not in ${zipResult.zip} yet. Call us below and we'll let you know as soon as we're in your area.`}
            </p>
          )}
        </section>

        {/* FAQ */}
        <section className="mt-12">
          <span className="kicker">Have questions?</span>
          <h2 className="mt-2 text-lg font-bold text-gray-900">We've got answers</h2>
          <div className="mt-4">
            <FaqAccordion faqs={GET_STARTED_FAQS} />
          </div>
        </section>

        {/* Support - a plain number + tel: link, not the interactive browser-calling widget (that
            needs a signed-in customer session, which an anonymous visitor doesn't have yet). */}
        <section id="support" className="mt-12 scroll-mt-6">
          <span className="kicker">Prefer to talk it through?</span>
          <h2 className="mt-2 text-lg font-bold text-gray-900">Call customer support</h2>
          <div className="mt-4 rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-6 text-white shadow-sm sm:p-8">
            <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-white/80">
              <PhoneIcon className="h-4 w-4" /> Call customer care
            </p>
            {careLine && (
              <a href={`tel:${careLine}`} className="mt-2 block text-2xl font-bold text-white hover:underline">
                {careLine}
              </a>
            )}
            <p className="mt-3 max-w-lg text-sm text-white/85">
              <HeadsetIcon className="mr-1 inline h-4 w-4 align-text-bottom" />
              Our assistant answers first and can check service availability, walk you through plans, and get you signed up right over the phone.
            </p>
          </div>
        </section>
      </main>

      {/* Utility footer - "My account" (user request, Sep 30 - dropped the separate "Employee
          login" link that used to sit next to it, no need to advertise a staff login on a public
          commercial page). Routes to the shared /login, which already sends an employee to
          /admin/dashboard and a customer to /portal/account. */}
      <footer className="border-t border-gray-200 py-6">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-2 px-4 text-xs text-gray-500 sm:flex-row sm:justify-between sm:px-6">
          <p>© {new Date().getFullYear()} {brand}</p>
          <a href="/login" className="hover:text-brand-600">
            My account
          </a>
        </div>
      </footer>
    </div>
  );
}
