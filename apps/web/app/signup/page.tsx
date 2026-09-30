"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { customerSignup, purchasePlan, fetchPublicPlans, type PlanInfo } from "../../lib/api";
import { AuthLayout, Field, PasswordInput, SubmitButton, inputClass } from "../../components/AuthLayout";
import { LogoMark } from "../../components/icons";
import { formatMoney } from "../../lib/format";

// Account creation only happens as part of buying a plan now (user request, Sep 30: "in the login
// page there should not be a create an account page option, that should only happen when the user
// selects a plan and proceeds for purchasing... once its done, the user is created and then they
// can login") - /login no longer links here at all, and a bare /signup with no ?plan=<name> (picked
// on a plan card on the public homepage) redirects to the plans section instead of showing a form.
// Signup and purchase happen back to back in one submit here, and the assigned BAN+PIN are shown
// immediately, no extra page.
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
  // Set only for the "email already exists" case - the page has no persistent sign-in link by
  // design (user request), but leaving someone at a genuine dead end when they hit this specific
  // error would be a real bug, not just missing decoration - so the fix is scoped to this one state.
  const [emailExists, setEmailExists] = useState(false);
  const [loading, setLoading] = useState(false);
  const [purchased, setPurchased] = useState<{ ban: string; pin: string; planName: string } | null>(null);

  useEffect(() => {
    if (!planName) {
      router.replace("/#plans");
      return;
    }
    fetchPublicPlans()
      .then((plans) => setSelectedPlan(plans.find((p) => p.name === planName) ?? null))
      .catch(() => {});
  }, [planName, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!planName) return;
    if (password !== confirm) return setError("Passwords don't match.");

    setLoading(true);
    setError(null);
    setEmailExists(false);
    try {
      await customerSignup(name.trim(), email.trim(), password);
      const result = await purchasePlan(planName);
      setPurchased(result);
    } catch (err) {
      const msg = String(err);
      if (msg.includes("409")) {
        setError("An account with that email already exists.");
        setEmailExists(true);
      } else if (msg.includes("400")) setError("Please check your details. The password needs at least 8 characters.");
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

  if (!planName) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-gray-400">Redirecting…</div>;
  }

  return (
    <AuthLayout title={selectedPlan ? `Get ${selectedPlan.name}` : "Create your account"}>
      <div className="mb-5 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3">
        <p className="text-sm font-semibold text-brand-800">
          {selectedPlan ? `${selectedPlan.name} - ${formatMoney(selectedPlan.monthlyPrice)}/mo` : planName}
        </p>
        {selectedPlan && <p className="mt-0.5 text-xs text-brand-700">{selectedPlan.description}</p>}
      </div>
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
            {emailExists && (
              <>
                {" "}
                <Link href="/login" className="font-medium underline hover:text-red-800">
                  Sign in
                </Link>{" "}
                instead.
              </>
            )}
          </p>
        )}
        <SubmitButton loading={loading} loadingText="Setting up…">
          Create account & activate
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
