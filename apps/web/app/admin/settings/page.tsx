"use client";

import { useEffect, useState } from "react";
import { employeeMe, employeeSignup, fetchSettings, saveSettings, type EmployeeAccount, type TenantSettings } from "../../../lib/api";
import { AdminShell, Card, ErrorNote } from "../../../components/AdminShell";
import { Badge } from "../../../components/Badge";

// Tenant configuration for the care line (PRD VN-7 brand voice / language / pronunciation, VN-9
// greeting / hold / close prompts, compliance disclosures, escalation rules, cost model). Everything
// is validated server-side against the same schema the call engine reads. Intent on/off and example
// utterances live on the Intents page.
const PHONE_VOICES: Record<TenantSettings["language"], { value: string; label: string }[]> = {
  "en-US": [
    { value: "Polly.Joanna", label: "Joanna (US English, female)" },
    { value: "Polly.Matthew", label: "Matthew (US English, male)" },
    { value: "Polly.Salli", label: "Salli (US English, female)" },
  ],
  "es-US": [
    { value: "Polly.Lupe", label: "Lupe (US Spanish, female)" },
    { value: "Polly.Miguel", label: "Miguel (US Spanish, male)" },
  ],
  "hi-IN": [{ value: "Polly.Aditi", label: "Aditi (Hindi / Indian English, female)" }],
};

type Form = Omit<TenantSettings, "intentOverrides">;

function withoutIntents(s: TenantSettings): Form {
  const { intentOverrides: _ignored, ...rest } = s;
  return rest;
}

export default function SettingsPage() {
  const [employee, setEmployee] = useState<EmployeeAccount | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [preview, setPreview] = useState<{ greeting: string; greetingSpoken: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    employeeMe()
      .then(({ employee }) => setEmployee(employee))
      .catch(() => {});
    fetchSettings()
      .then(({ settings, preview }) => {
        setForm(withoutIntents(settings));
        setPreview(preview);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  async function save() {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const { settings, preview } = await saveSettings(form);
      setForm(withoutIntents(settings));
      setPreview(preview);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(readableError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell
      title="Settings"
      subtitle="How the assistant sounds, what it discloses, when it hands off, and your organization."
      actions={
        form && (
          <div className="flex items-center gap-3">
            {savedAt && <span className="text-xs text-gray-500">Saved {savedAt} · applies to new calls</span>}
            <button onClick={() => void save()} disabled={saving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-60">
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        )
      }
    >
      <ErrorNote error={error} />
      {form && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Brand voice & language" subtitle="VN-7">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Brand name" value={form.brandName} onChange={(v) => set("brandName", v)} />
                <TextField label="Assistant name" value={form.assistantName} onChange={(v) => set("assistantName", v)} />
              </div>
              <TextField label="Brand voice" hint="How replies are worded, e.g. “warm, upbeat, concise”." value={form.voiceTone} onChange={(v) => set("voiceTone", v)} />
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  label="Language"
                  value={form.language}
                  onChange={(v) => {
                    const language = v as Form["language"];
                    setForm((f) => (f ? { ...f, language, phoneVoice: PHONE_VOICES[language][0].value } : f));
                  }}
                  options={[
                    { value: "en-US", label: "English (US)" },
                    { value: "es-US", label: "Spanish (US)" },
                    { value: "hi-IN", label: "Hindi (India)" },
                  ]}
                />
                <SelectField label="Phone voice" value={form.phoneVoice} onChange={(v) => set("phoneVoice", v)} options={PHONE_VOICES[form.language]} />
              </div>
              <p className="text-xs text-gray-500">
                For a non-English language, speech recognition, the voice and every reply switch over. Replies are translated by the AI and fall back to English if
                it&apos;s unavailable.
              </p>
            </div>
          </Card>

          <Card title="Pronunciation overrides" subtitle="Applied to what's spoken only — transcripts keep the real text">
            <PronunciationEditor rows={form.pronunciations} onChange={(rows) => set("pronunciations", rows)} />
          </Card>

          <Card title="Prompts" subtitle="VN-9 · {brand} and {assistant} are filled in; {disclosures} is where the notices below go" className="lg:col-span-2">
            <div className="space-y-4">
              <TextField label="Greeting" value={form.greetingPrompt} onChange={(v) => set("greetingPrompt", v)} />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Hold prompt" hint="Phone calls, while a slow reply is being prepared." value={form.holdPrompt} onChange={(v) => set("holdPrompt", v)} />
                <TextField label="Closing" value={form.closePrompt} onChange={(v) => set("closePrompt", v)} />
              </div>
              {preview && (
                <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Saved greeting, as callers hear it</p>
                  <p className="mt-1 text-gray-800">{preview.greeting}</p>
                  {preview.greetingSpoken !== preview.greeting && <p className="mt-1 text-xs text-gray-500">Spoken as: {preview.greetingSpoken}</p>}
                </div>
              )}
            </div>
          </Card>

          <Card title="Disclosure & recording" subtitle="Compliance · configurable per jurisdiction">
            <div className="space-y-4">
              <Toggle label="Tell callers they're talking to an automated assistant" checked={form.aiDisclosureEnabled} onChange={(v) => set("aiDisclosureEnabled", v)} />
              {form.aiDisclosureEnabled && <TextField label="AI disclosure" value={form.aiDisclosureText} onChange={(v) => set("aiDisclosureText", v)} />}
              <Toggle label="Record calls" checked={form.recordingEnabled} onChange={(v) => set("recordingEnabled", v)} />
              {form.recordingEnabled && (
                <>
                  <Toggle label="Announce recording in the greeting" checked={form.recordingDisclosureEnabled} onChange={(v) => set("recordingDisclosureEnabled", v)} />
                  {form.recordingDisclosureEnabled && <TextField label="Recording notice" value={form.recordingDisclosureText} onChange={(v) => set("recordingDisclosureText", v)} />}
                </>
              )}
            </div>
          </Card>

          <Card title="Escalation & survey" subtitle="Rule-based (PRD §13)">
            <div className="space-y-4">
              <Toggle label="Transfer whenever a caller asks for an agent" checked={form.escalateOnAgentRequest} onChange={(v) => set("escalateOnAgentRequest", v)} />
              <p className="-mt-2 text-xs text-gray-500">When off, the assistant offers a callback instead.</p>
              <NumberField
                label="Misunderstood turns before offering an agent or callback"
                value={form.unknownTurnsBeforeEscalation}
                min={1}
                max={5}
                step={1}
                onChange={(v) => set("unknownTurnsBeforeEscalation", v)}
              />
              <TextField
                label="Agent transfer number (phone calls)"
                hint="E.164, e.g. +15551234567. Leave blank to queue the handoff and end the call."
                value={form.agentTransferNumber}
                onChange={(v) => set("agentTransferNumber", v)}
              />
              <Toggle label="Ask for a 1–5 satisfaction rating at the end of automated calls" checked={form.csatSurveyEnabled} onChange={(v) => set("csatSurveyEnabled", v)} />
            </div>
          </Card>

          <Card title="Cost model" subtitle="Your own rates, used for “cost per care call” in Reports">
            <div className="grid gap-4 sm:grid-cols-3">
              <NumberField label="Automated $/min" value={form.costPerMinuteAutomated} min={0} step={0.01} onChange={(v) => set("costPerMinuteAutomated", v)} />
              <NumberField label="Agent $/min" value={form.costPerMinuteAgent} min={0} step={0.05} onChange={(v) => set("costPerMinuteAgent", v)} />
              <NumberField label="Agent min per handoff" value={form.agentMinutesPerEscalation} min={0} step={0.5} onChange={(v) => set("agentMinutesPerEscalation", v)} />
            </div>
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
          <Card title="Caller verification rules" subtitle="Fixed in code — identity before action" className="lg:col-span-2">
            <Rows
              rows={[
                ["Caller ID (ANI)", "Captured for display only — never grants access"],
                ["Account lookup", "Caller must give a valid 6-digit BAN"],
                ["PIN", "4 digits, 3 attempts per call, then escalate to an agent"],
                ["One-time code", "6 digits by email or SMS, expires after 5 minutes, 3 attempts, “resend” issues a new code"],
                ["Data release", "Only the fields the detected intent needs, and only after verification (see Intents)"],
                ["Irreversible actions", "Payments, plan changes and bookings are read back and need an explicit yes"],
                ["AI role", "Understands and phrases language; the server makes every verification and account decision"],
              ]}
            />
          </Card>
        </div>
      )}
    </AdminShell>
  );
}

function readableError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  try {
    const fields = JSON.parse(msg.slice(msg.indexOf("{")))?.error?.fieldErrors as Record<string, string[]> | undefined;
    if (fields && Object.keys(fields).length) {
      return `Couldn't save: ${Object.entries(fields)
        .map(([k, v]) => `${k} — ${v.join(", ")}`)
        .join("; ")}`;
    }
  } catch {
    // not a validation error — fall through
  }
  return `Couldn't save: ${msg}`;
}

const fieldClass = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

function TextField({ label, hint, value, onChange }: { label: string; hint?: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-gray-700">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className={fieldClass} />
      {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

function NumberField({ label, value, min, max, step, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-gray-700">{label}</span>
      <input type="number" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} className={fieldClass} />
    </label>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-gray-700">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${fieldClass} bg-white`}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-gray-700">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-brand-600" : "bg-gray-300"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? "left-5" : "left-0.5"}`} />
      </button>
    </div>
  );
}

function PronunciationEditor({ rows, onChange }: { rows: TenantSettings["pronunciations"]; onChange: (rows: TenantSettings["pronunciations"]) => void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  return (
    <div>
      <ul className="divide-y divide-gray-100 text-sm">
        {rows.map((r, i) => (
          <li key={`${r.from}-${i}`} className="flex items-center justify-between gap-3 py-2">
            <span>
              <span className="font-medium text-gray-900">{r.from}</span> <span className="text-gray-400">→</span> <span className="text-gray-700">“{r.to}”</span>
            </span>
            <button onClick={() => onChange(rows.filter((_, j) => j !== i))} className="text-xs font-medium text-gray-500 hover:text-red-600">
              Remove
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="py-2 text-gray-500">No overrides.</li>}
      </ul>
      <div className="mt-3 flex gap-2">
        <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Written (e.g. BAN)" className={fieldClass} />
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Say as (e.g. B-A-N)" className={fieldClass} />
        <button
          onClick={() => {
            if (!from.trim() || !to.trim()) return;
            onChange([...rows, { from: from.trim(), to: to.trim() }]);
            setFrom("");
            setTo("");
          }}
          className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="space-y-2.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-0.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
          <dt className="text-gray-500">{k}</dt>
          <dd className="break-words text-gray-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

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
      <button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
        {saving ? "Adding…" : "Add admin"}
      </button>
      {status && <p className={`text-sm sm:col-span-4 ${status.ok ? "text-green-700" : "text-red-600"}`}>{status.text}</p>}
    </form>
  );
}
