"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { customerSignup, purchasePlan, fetchPublicPlans, type PlanInfo } from "../../lib/api";
import { AuthLayout, Field, PasswordInput, SubmitButton, inputClass } from "../../components/AuthLayout";
import { LogoMark } from "../../components/icons";
import { formatMoney } from "../../lib/format";

// Public signup creates a web login (employee accounts are created by an existing admin) - no BAN
// or phone PIN yet on its own. Two ways to end up with one:
//   1. Arriving with ?plan=<name> from a plan card on the public homepage (user request, Sep 30:
//      "instead of a sign up page, once they click on any plans/packages/services while
//      purchasing it we will get their details") - signup and purchase happen back to back, right
//      here, and the assigned BAN+PIN are shown immediately, no extra page.
//   2. A plain /signup visit with no plan context (bookmarked, or reached some other way) - falls
//      back to the original behavior, landing on /portal/get-started to pick a plan there.
function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planName = searchParams.get("plan");

  const [selectedPlan, setSelectedPlan] = useState<PlanInfo | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [purchased, setPurchased] = useState<{ ban: string; pin: string; planName: string } | null>(null);

  useEffect(() => {
    if (!planName) return;
    fetchPublicPlans()
      .then((plans) => setSelectedPlan(plans.find((p) => p.name === planName) ?? null))
      .catch(() => {});
  }, [planName]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("Passwords don't match.");

    setLoading(true);
    setError(null);
    try {
      await customerSignup(name.trim(), email.trim(), password);
      if (planName) {
        const result = await purchasePlan(planName);
        setPurchased(result);
        return;
      }
      router.push("/portal/get-started");
    } catch (err) {
      const msg = String(err);
      if (msg.includes("409")) setError("An account with that email already exists. Try signing in instead.");
      else if (msg.includes("400")) setError("Please check your details. The password needs at least 8 characters.");
      else setError("Couldn't create your account right now. Please try again.");
      setLoading(false);
    }
  }

  if (purchased) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12">
        <Link href="/" className="mb-8 flex items-center gap-2">
          <LogoMark className="h-7 w-7" />
          <span className="text-lg font-bold text-gray-900">Springfield Fiber</span>
        </Link>
        <section className="w-full max-w-md rounded-2xl border border-green-200 bg-green-50 p-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-green-700">You're all set</p>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">Welcome to {purchased.planName}!</h1>
          <p className="mx-auto mt-3 max-w-sm text-sm text-gray-600">
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
      </div>
    );
  }

  return (
    <AuthLayout
      title={selectedPlan ? `Get ${selectedPlan.name}` : "Create your account"}
      subtitle={
        <>
          Already have one?{" "}
          <Link href="/login" className="font-medium text-brand-600 hover:text-brand-700">
            Sign in
          </Link>
        </>
      }
    >
      {planName && (
        <div className="mb-5 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3">
          <p className="text-sm font-semibold text-brand-800">
            {selectedPlan ? `${selectedPlan.name} - ${formatMoney(selectedPlan.monthlyPrice)}/mo` : planName}
          </p>
          {selectedPlan && <p className="mt-0.5 text-xs text-brand-700">{selectedPlan.description}</p>}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-5">
        <Field label="Full name" htmlFor="name">
          <input id="name" required autoComplete="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Email" htmlFor="email">
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 8 characters.">
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" minLength={8} />
        </Field>
        <Field label="Confirm password" htmlFor="confirm">
          <PasswordInput id="confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" minLength={8} />
        </Field>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {error}
          </p>
        )}
        <SubmitButton loading={loading} loadingText={planName ? "Setting up…" : "Creating account…"}>
          {planName ? "Create account & activate" : "Create account"}
        </SubmitButton>
      </form>
    </AuthLayout>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}
