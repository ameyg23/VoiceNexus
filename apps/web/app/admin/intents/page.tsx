"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchIntents, fetchSettings, saveSettings, type IntentCatalogEntry, type TenantSettings } from "../../../lib/api";
import { AdminShell, Card, ErrorNote } from "../../../components/AdminShell";
import { PencilIcon, PowerIcon, SearchIcon } from "../../../components/icons";
import { percent } from "../../../lib/format";

// Operator-curated intent catalog (PRD §5 tertiary user: "configures intents, utterances"). The
// intents themselves and their subflows are code-defined; operations can switch an intent off (the
// assistant then states the limit and offers an agent or callback) and add example utterances that
// are fed to the AI classifier.
export default function IntentsPage() {
  const [intents, setIntents] = useState<IntentCatalogEntry[] | null>(null);
  const [overrides, setOverrides] = useState<TenantSettings["intentOverrides"]>({});
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchIntents(), fetchSettings()])
      .then(([{ intents }, { settings }]) => {
        setIntents(intents);
        setOverrides(settings.intentOverrides);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function persist(next: TenantSettings["intentOverrides"]) {
    setOverrides(next);
    try {
      await saveSettings({ intentOverrides: next });
      setSavedAt(new Date().toLocaleTimeString());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const current = (i: IntentCatalogEntry) => overrides[i.intent] ?? { enabled: true, examples: [] };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!intents || !needle) return intents;
    return intents.filter((i) => [i.label, i.description, ...i.examples, ...current(i).examples].some((v) => v.toLowerCase().includes(needle)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intents, q, overrides]);

  return (
    <AdminShell
      title="Intents"
      subtitle="Manage intents and training phrases"
      actions={savedAt && <span className="text-xs text-gray-500">Saved {savedAt} · applies to the next caller turn</span>}
    >
      <ErrorNote error={error} />
      <Card>
        <label className="relative mb-5 block w-full max-w-sm">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search intent…"
            className="w-full rounded-xl border border-gray-200 bg-gray-100 py-2.5 pl-10 pr-3 text-sm focus:border-brand-500 focus:bg-white focus:outline-none"
          />
        </label>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="py-3 pr-4">Intent name</th>
                <th className="py-3 pr-4">Description</th>
                <th className="py-3 pr-4">Utterances (examples)</th>
                <th className="py-3 pr-4 text-right">Calls</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered?.map((i) => {
                const o = current(i);
                const locked = i.intent === "UNKNOWN";
                const examples = [...i.examples, ...o.examples];
                return (
                  <Fragment key={i.intent}>
                    <tr className={`border-b border-gray-100 align-top ${o.enabled ? "" : "opacity-60"}`}>
                      <td className="py-5 pr-4 font-semibold text-gray-900">{i.label}</td>
                      <td className="max-w-72 py-5 pr-4 text-gray-600">
                        {i.description}
                        {i.dataShared.length > 0 && <p className="mt-1 text-xs text-gray-400">Releases: {i.dataShared.join(", ")}</p>}
                      </td>
                      <td className="max-w-80 py-5 pr-4 text-gray-600">{examples.join(", ")}</td>
                      <td className="py-5 pr-4 text-right tabular-nums">
                        {i.total > 0 ? (
                          <Link href={`/admin/calls?intent=${i.intent}`} className="font-medium text-brand-600 hover:text-brand-700" title={`${percent(i.resolved, i.total)} contained`}>
                            {i.total}
                          </Link>
                        ) : (
                          <span className="text-gray-400">0</span>
                        )}
                      </td>
                      <td className="py-5 pr-4">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${o.enabled ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}
                        >
                          {locked ? "Always on" : o.enabled ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap py-5 pr-4 text-right">
                        {!locked && (
                          <>
                            <button
                              onClick={() => setEditing(editing === i.intent ? null : i.intent)}
                              className={`rounded-lg p-2 hover:bg-gray-100 ${editing === i.intent ? "text-brand-600" : "text-gray-500"}`}
                              title="Edit training phrases"
                              aria-label={`Edit training phrases for ${i.label}`}
                            >
                              <PencilIcon className="h-5 w-5" />
                            </button>
                            <button
                              onClick={() => void persist({ ...overrides, [i.intent]: { ...o, enabled: !o.enabled } })}
                              className={`rounded-lg p-2 hover:bg-gray-100 ${o.enabled ? "text-gray-500" : "text-green-600"}`}
                              title={o.enabled ? "Disable intent" : "Enable intent"}
                              aria-label={o.enabled ? `Disable ${i.label}` : `Enable ${i.label}`}
                            >
                              <PowerIcon className="h-5 w-5" />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                    {editing === i.intent && (
                      <tr className="border-b border-gray-100 bg-gray-50/60">
                        <td colSpan={6} className="px-4 py-4">
                          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Custom training phrases for {i.label}</p>
                          <ExampleEditor examples={o.examples} onChange={(ex) => void persist({ ...overrides, [i.intent]: { ...o, examples: ex } })} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-gray-500">
          Intents and what they do are built into the assistant; here you switch them on or off and add phrases your callers use. Disabled intents get an honest “I
          can&apos;t help with that” plus an agent or callback offer.
        </p>
      </Card>
    </AdminShell>
  );
}

function ExampleEditor({ examples, onChange }: { examples: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState("");
  function add() {
    const text = draft.trim();
    if (!text || examples.includes(text)) return;
    onChange([...examples, text]);
    setDraft("");
  }
  return (
    <div className="mt-2">
      {examples.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {examples.map((e) => (
            <span key={e} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs text-brand-700">
              “{e}”
              <button onClick={() => onChange(examples.filter((x) => x !== e))} className="text-brand-400 hover:text-brand-700" aria-label={`Remove ${e}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex max-w-lg gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add a phrase a caller might say, then press Enter"
          className="flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
        <button onClick={add} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
          Add
        </button>
      </div>
    </div>
  );
}
