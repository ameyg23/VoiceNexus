"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "../../lib/api";
import { AuthLayout, Field, PasswordInput, SubmitButton, inputClass } from "../../components/AuthLayout";

// One sign-in for everyone — the server routes employees to the ops dashboard and customers to
// their account page based on whose credentials these are.
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { redirectTo } = await login(email.trim(), password);
      router.push(redirectTo);
    } catch (err) {
      setError(String(err).includes("401") ? "Incorrect email or password." : "Couldn't sign you in right now. Please try again.");
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Sign in">
      <form onSubmit={handleSubmit} className="space-y-5">
        <Field label="Email" htmlFor="email">
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
        </Field>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {error}
          </p>
        )}
        <SubmitButton loading={loading} loadingText="Signing in…">
          Sign in
        </SubmitButton>
      </form>
    </AuthLayout>
  );
}
