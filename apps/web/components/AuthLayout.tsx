"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchSession } from "../lib/api";
import { LogoMark, CheckIcon } from "./icons";

// Split-screen layout shared by /login and /signup: brand panel on the left (hidden on small
// screens), form on the right. Visitors who are already signed in are sent straight home.
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: React.ReactNode; children: React.ReactNode }) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetchSession()
      .then((s) => router.replace(s.redirectTo))
      .catch(() => setChecking(false));
  }, [router]);

  return (
    <div className="flex min-h-screen bg-white">
      <aside className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-brand-800 p-12 text-white lg:flex">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="rounded-lg bg-white/15 p-1">
            <LogoMark className="h-7 w-7" />
          </span>
          <span className="text-lg font-bold">Springfield Fiber</span>
        </Link>

        <div className="max-w-md">
          <h2 className="text-3xl font-bold leading-tight">Your account, one sign-in away.</h2>
          <p className="mt-3 text-brand-100">Check your balance, see your next bill, and manage your plan — or call us any time and our AI assistant will help.</p>
          <ul className="mt-8 space-y-3 text-sm text-brand-50">
            {["Balance, due dates and payment history", "Plan and autopay details", "The same PIN verifies you when you call"].map((line) => (
              <li key={line} className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20">
                  <CheckIcon className="h-3.5 w-3.5" />
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-brand-200">© {new Date().getFullYear()} Springfield Fiber · Powered by VoiceNexus</p>
        <div className="pointer-events-none absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -right-10 top-1/3 h-40 w-40 rounded-full bg-white/5" />
      </aside>

      <main className="flex flex-1 items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-10 flex items-center gap-2 lg:hidden">
            <LogoMark className="h-7 w-7" />
            <span className="text-lg font-bold text-gray-900">Springfield Fiber</span>
          </Link>
          {checking ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
              <p className="mt-1.5 text-sm text-gray-500">{subtitle}</p>
              <div className="mt-8">{children}</div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export const inputClass =
  "block w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-gray-700">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

export function PasswordInput({ id, value, onChange, autoComplete, minLength }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; minLength?: number }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? "text" : "password"}
        required
        minLength={minLength}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} pr-16`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 px-3.5 text-xs font-medium text-gray-500 hover:text-gray-700"
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? "Hide" : "Show"}
      </button>
    </div>
  );
}

export function SubmitButton({ loading, children, loadingText }: { loading: boolean; children: React.ReactNode; loadingText: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? loadingText : children}
    </button>
  );
}
