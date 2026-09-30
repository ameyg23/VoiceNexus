"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { logout, employeeMe, type EmployeeAccount } from "../lib/api";
import { Sidebar } from "./Sidebar";
import { ConfirmDialog } from "./ConfirmDialog";
import { LogoMark, MenuIcon } from "./icons";

// Every /admin page renders inside this: it checks the employee session once,
// bounces to /login if there isn't one, and lays out the sidebar + page header. The server
// independently enforces employee auth on every data endpoint — this is only the UX redirect.
export function AdminShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [employee, setEmployee] = useState<EmployeeAccount | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  useEffect(() => {
    let cancelled = false;
    employeeMe()
      .then(({ employee }) => {
        if (!cancelled) setEmployee(employee);
      })
      .catch(() => {
        if (!cancelled) router.replace("/login");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  if (!employee) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-gray-400">Loading…</div>;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar orgName="Springfield Fiber" employeeName={employee.name} onLogout={() => setConfirmingLogout(true)} open={menuOpen} onClose={() => setMenuOpen(false)} />
      <ConfirmDialog
        open={confirmingLogout}
        title="Log out?"
        message="You'll need to sign in again to get back to the dashboard."
        confirmLabel="Log out"
        onConfirm={() => void handleLogout()}
        onCancel={() => setConfirmingLogout(false)}
      />
      {menuOpen && <div className="fixed inset-0 z-30 bg-gray-900/30 lg:hidden" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center gap-3 bg-ink-950 px-4 py-3 lg:hidden">
          <button onClick={() => setMenuOpen(true)} className="rounded-lg p-2 text-gray-300 hover:bg-white/10 hover:text-white" aria-label="Open menu">
            <MenuIcon className="h-5 w-5" />
          </button>
          <LogoMark className="h-6 w-6" />
          <span className="font-bold text-white">VoiceNexus</span>
        </header>
      <main className="mx-auto min-w-0 max-w-[1400px] px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">{title}</h1>
            {subtitle && <p className="mt-2 text-[15px] text-gray-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
        <div className="mt-8">{children}</div>
      </main>
      </div>
    </div>
  );
}

export function Card({ title, subtitle, children, className = "" }: { title?: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-[0_1px_3px_rgba(16,24,40,0.06)] sm:p-7 ${className}`}>
      {title && <h2 className="text-base font-semibold text-gray-900">{title}</h2>}
      {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
      <div className={title || subtitle ? "mt-5" : ""}>{children}</div>
    </section>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
      <p className="text-sm font-medium text-gray-600">{label}</p>
      <p className="mt-3 text-[26px] font-bold leading-none text-gray-900 tabular-nums">{value}</p>
      {hint && <p className="mt-3 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">{children}</div>;
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
}
