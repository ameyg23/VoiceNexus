"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { customerSignup } from "../../lib/api";
import { AuthLayout, Field, PasswordInput, SubmitButton, inputClass } from "../../components/AuthLayout";

// Public signup only creates a web login (employee accounts are created by an existing admin) - no
// BAN or phone PIN yet. Those get assigned when the customer actually buys a plan on the page they
// land on right after this (/portal/get-started), which is what makes them a real customer.
export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("Passwords don't match.");

    setLoading(true);
    setError(null);
    try {
      await customerSignup(name.trim(), email.trim(), password);
      router.push("/portal/get-started");
    } catch (err) {
      const msg = String(err);
      if (msg.includes("409")) setError("An account with that email already exists. Try signing in instead.");
      else if (msg.includes("400")) setError("Please check your details. The password needs at least 8 characters.");
      else setError("Couldn't create your account right now. Please try again.");
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle={
        <>
          Already have one?{" "}
          <Link href="/login" className="font-medium text-brand-600 hover:text-brand-700">
            Sign in
          </Link>
        </>
      }
    >
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
        <SubmitButton loading={loading} loadingText="Creating account…">
          Create account
        </SubmitButton>
      </form>
    </AuthLayout>
  );
}
