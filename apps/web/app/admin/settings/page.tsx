"use client";

import { useEffect, useState } from "react";
import { employeeMe, type EmployeeAccount } from "../../../lib/api";
import { AdminShell, Card } from "../../../components/AdminShell";
import { Badge } from "../../../components/Badge";

// Read-only for the POC: single company, every signup is ADMIN, and the call-handling rules are fixed
// in code (authStateMachine.ts / otpService.ts). Shown here so ops can see the rules callers face.
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
          <Rows rows={[["Company", "Springfield Fiber"], ["Care line", "AI IVR (VoiceNexus)"], ["Employee roles", "Every signup is Admin (no role management in this POC)"]]} />
        </Card>
        <Card title="Your profile">
          {employee ? (
            <Rows rows={[["Name", employee.name], ["Email", employee.email], ["Role", <Badge key="r" tone="info">{employee.role}</Badge>]]} />
          ) : (
            <p className="text-sm text-gray-400">Loading…</p>
          )}
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
