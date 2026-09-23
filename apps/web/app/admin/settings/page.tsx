"use client";

import { useEffect, useState } from "react";
import { employeeMe, employeeSignup, type EmployeeAccount } from "../../../lib/api";
import { AdminShell, Card } from "../../../components/AdminShell";
import { Badge } from "../../../components/Badge";

// Mostly read-only for the POC: single company, every employee is ADMIN, and the call-handling rules
// are fixed in code (authStateMachine.ts / otpService.ts). The one action: adding another admin.
export default function SettingsPage() {
  const [employee, setEmployee] = useState<EmployeeAccount | null>(null);

  useEffect(() => {
    employeeMe()
      .then(({ employee }) => setEmployee(employee))
      .catch(() => {});
  }, []);

  return (
    <AdminShell title="Settings" subtitle="Organization, your profile, and the call-handling rules in effect.">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Organization">
          <Rows rows={[["Company", "Springfield Fiber"], ["Care line", "AI IVR (VoiceNexus)"], ["Employee roles", "Every employee is Admin (no role management in this POC)"]]} />
        </Card>
        <Card title="Your profile">
          {employee ? (
            <Rows rows={[["Name", employee.name], ["Email", employee.email], ["Role", <Badge key="r" tone="info">{employee.role}</Badge>]]} />
          ) : (
            <p className="text-sm text-gray-400">Loading…</p>
          )}
        </Card>
        <Card title="Add an admin" subtitle="The public sign-up page creates customer accounts — admin accounts are added here." className="lg:col-span-2">
          <AddAdminForm />
        </Card>
        <Card title="Caller verification rules" className="lg:col-span-2">
          <Rows
            rows={[
              ["Caller ID (ANI)", "Captured for display only — never grants access"],
              ["Account lookup", "Caller must give a valid 6-digit BAN"],
              ["PIN", "4 digits, 3 attempts per call, then escalate to an agent"],
              ["One-time code", "6 digits by email or SMS, expires after 5 minutes, 3 attempts, “resend” issues a new code"],
              ["Data release", "Only the fields the detected intent needs, and only after verification (see Intents)"],
              ["AI role", "Understands and phrases language; the server makes every verification decision"],
            ]}
          />
        </Card>
      </div>
    </AdminShell>
  );
}

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="space-y-2.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[10rem_1fr] gap-4">
          <dt className="text-gray-500">{k}</dt>
          <dd className="text-gray-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20";

function AddAdminForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      const { employee } = await employeeSignup(name.trim(), email.trim(), password);
      setStatus({ ok: true, text: `${employee.name} can now sign in at /login with ${employee.email}.` });
      setName("");
      setEmail("");
      setPassword("");
    } catch (err) {
      const msg = String(err);
      setStatus({ ok: false, text: msg.includes("409") ? "An account with that email already exists." : msg.includes("400") ? "Check the details — password needs 8+ characters." : "Couldn't add the admin." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
      <label className="text-sm">
        <span className="mb-1 block text-gray-600">Name</span>
        <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-gray-600">Email</span>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-gray-600">Temporary password</span>
        <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
      </label>
      <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">
        {saving ? "Adding…" : "Add admin"}
      </button>
      {status && <p className={`text-sm sm:col-span-4 ${status.ok ? "text-green-700" : "text-red-600"}`}>{status.text}</p>}
    </form>
  );
}
