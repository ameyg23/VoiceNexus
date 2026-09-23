"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchIntents, fetchSettings, saveSettings, type IntentCatalogEntry, type TenantSettings } from "../../../lib/api";
import { AdminShell, Card, ErrorNote } from "../../../components/AdminShell";
import { Badge } from "../../../components/Badge";
import { SearchIcon } from "../../../components/icons";
import { percent } from "../../../lib/format";

// Operator-curated intent catalog (PRD §5 tertiary user: "configures intents, utterances"). The
// intents themselves and their subflows are code-defined; operations can switch an intent off (the
// assistant then states the limit and offers an agent or callback) and add example utterances that
// are fed to the AI classifier.
export default function IntentsPage() {
  const [intents, setIntents] = useState<IntentCatalogEntry[] | null>(null);
  const [overrides, setOverrides] = useState<TenantSettings["intentOverrides"]>({});
  const [q, setQ] = useState("");
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
    <AdminShell title="Intents" subtitle="What callers can ask for, what each intent may release once they're verified, and how it's configured.">
      <ErrorNote error={error} />
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <label className="relative block w-full max-w-sm">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search intent or utterance…"
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none"
            />
          </label>
          <p className="text-xs text-gray-500">{savedAt ? `Saved ${savedAt} · applies to the next caller turn` : "Changes save immediately and apply to live calls."}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="py-3 pr-4">Intent</th>
                <th className="py-3 pr-4">Description</th>
                <th className="py-3 pr-4">Utterances</th>
                <th className="py-3 pr-4">Data released</th>
                <th className="py-3 pr-4 text-right">Calls</th>
                <th className="py-3 pr-4 text-right">Contained</th>
                <th className="py-3 pr-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered?.map((i) => {
                const o = current(i);
                const locked = i.intent === "UNKNOWN";
                return (
                  <tr key={i.intent} className={`border-b border-gray-100 align-top ${o.enabled ? "" : "bg-gray-50/70"}`}>
                    <td className="py-3 pr-4">
                      <p className="font-semibold text-gray-900">{i.label}</p>
                      <p className="text-xs text-gray-400">{i.intent}</p>
                    </td>
                    <td className="max-w-64 py-3 pr-4 text-gray-600">{i.description}</td>
                    <td className="max-w-80 py-3 pr-4">
                      <p className="text-gray-600">{i.examples.map((e) => `“${e}”`).join(", ")}</p>
                      {!locked && (
                        <ExampleEditor
                          examples={o.examples}
                          onChange={(examples) => void persist({ ...overrides, [i.intent]: { ...o, examples } })}
                        />
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {i.dataShared.length === 0 ? (
                        <span className="text-gray-400">None</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {i.dataShared.map((d) => (
                            <Badge key={d}>{d}</Badge>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums">
                      {i.total > 0 ? (
                        <Link href={`/admin/calls?intent=${i.intent}`} className="text-blue-600 hover:text-blue-700">
                          {i.total}
                        </Link>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-right text-gray-700 tabular-nums">{percent(i.resolved, i.total)}</td>
                    <td className="py-3 pr-4">
                      {locked ? (
                        <Badge tone="neutral">Always on</Badge>
                      ) : (
                        <button
                          onClick={() => void persist({ ...overrides, [i.intent]: { ...o, enabled: !o.enabled } })}
                          className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
                            o.enabled ? "bg-green-50 text-green-700 ring-green-600/20 hover:bg-green-100" : "bg-gray-100 text-gray-600 ring-gray-500/10 hover:bg-gray-200"
                          }`}
                          title={o.enabled ? "Click to disable" : "Click to enable"}
                        >
                          {o.enabled ? "Active" : "Disabled"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
        <div className="mb-1.5 flex flex-wrap gap-1">
          {examples.map((e) => (
            <span key={e} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
              “{e}”
              <button onClick={() => onChange(examples.filter((x) => x !== e))} className="text-blue-400 hover:text-blue-700" aria-label={`Remove ${e}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        placeholder="+ add an example, press Enter"
        className="w-full rounded-md border border-dashed border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none"
      />
    </div>
  );
}
