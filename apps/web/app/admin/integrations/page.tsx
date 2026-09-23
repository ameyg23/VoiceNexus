"use client";

import { useEffect, useState } from "react";
import { fetchIntegrations, type IntegrationsStatus } from "../../../lib/api";
import { AdminShell, ErrorNote } from "../../../components/AdminShell";
import { Badge } from "../../../components/Badge";

export default function IntegrationsPage() {
  const [status, setStatus] = useState<IntegrationsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchIntegrations()
      .then(setStatus)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <AdminShell title="Integrations" subtitle="External services this deployment uses. Secrets never leave the server — this shows configured / not configured only.">
      <ErrorNote error={error} />
      {status && (
        <div className="grid gap-4 md:grid-cols-2">
          <IntegrationCard
            name="Google Gemini"
            role="Slot extraction, intent classification, response phrasing. Never makes the auth decision."
            ok={status.gemini.configured}
            rows={[
              ["Model", status.gemini.model],
              ["Fallback", "Regex extraction, keyword intents, template replies"],
            ]}
          />
          <IntegrationCard
            name="Resend"
            role="Delivers Email-OTP codes."
            ok={status.resend.configured}
            rows={[
              ["From", status.resend.fromEmail ?? "—"],
              ["Fallback", "Dev OTP console (demo mode)"],
            ]}
          />
          <IntegrationCard
            name="Twilio Voice"
            role="Real care-line phone calls: speech/keypad input, spoken replies, call recording."
            ok={status.twilio.configured && Boolean(status.twilio.publicBaseUrl)}
            warn={status.twilio.configured && !status.twilio.publicBaseUrl ? "Credentials set, no public webhook URL yet" : undefined}
            rows={[
              ["Care line", status.twilio.careLineNumber ?? "—"],
              ["Webhook base", status.twilio.publicBaseUrl ?? "Not set (PUBLIC_BASE_URL)"],
              ["Browser test calls", status.twilio.voiceSdkConfigured ? "Configured" : "Not set up (run twilio:setup)"],
            ]}
          />
          <IntegrationCard
            name="Browser speech (Demo Mode)"
            role="Web Speech API for speech-to-text and speechSynthesis for text-to-speech on /demo/call."
            ok
            rows={[
              ["Cost", "Free, runs in the browser"],
              ["Demo mode", status.demoMode ? "On" : "Off"],
            ]}
          />
        </div>
      )}
    </AdminShell>
  );
}

function IntegrationCard({ name, role, ok, warn, rows }: { name: string; role: string; ok: boolean; warn?: string; rows: [string, string][] }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold text-gray-900">{name}</h2>
        <Badge tone={warn ? "warning" : ok ? "success" : "neutral"}>{warn ? "Partial" : ok ? "Connected" : "Not configured"}</Badge>
      </div>
      <p className="mt-1 text-sm text-gray-500">{role}</p>
      {warn && <p className="mt-2 text-sm text-amber-700">{warn}</p>}
      <dl className="mt-4 space-y-1.5 border-t border-gray-100 pt-3 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="text-gray-500">{k}</dt>
            <dd className="text-right text-gray-900">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
