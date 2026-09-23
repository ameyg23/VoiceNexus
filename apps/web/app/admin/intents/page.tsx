"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchIntents, type IntentCatalogEntry } from "../../../lib/api";
import { AdminShell, Card, ErrorNote } from "../../../components/AdminShell";
import { Badge } from "../../../components/Badge";
import { SearchIcon } from "../../../components/icons";
import { percent } from "../../../lib/format";

export default function IntentsPage() {
  const [intents, setIntents] = useState<IntentCatalogEntry[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchIntents()
      .then(({ intents }) => setIntents(intents))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!intents || !needle) return intents;
    return intents.filter((i) => [i.label, i.description, ...i.examples].some((v) => v.toLowerCase().includes(needle)));
  }, [intents, q]);

  return (
    <AdminShell
      title="Intents"
      subtitle="What callers can ask for, and which account data each intent may release once they're verified."
    >
      <ErrorNote error={error} />
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <label className="relative block w-full max-w-sm">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search intent…"
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none"
            />
          </label>
          <p className="text-xs text-gray-500">Intents are defined in code (classifier + fulfillment), so this view is read-only.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="py-3 pr-4">Intent</th>
                <th className="py-3 pr-4">Description</th>
                <th className="py-3 pr-4">Utterances (examples)</th>
                <th className="py-3 pr-4">Data released</th>
                <th className="py-3 pr-4 text-right">Calls</th>
                <th className="py-3 pr-4 text-right">Contained</th>
              </tr>
            </thead>
            <tbody>
              {filtered?.map((i) => (
                <tr key={i.intent} className="border-b border-gray-100 align-top">
                  <td className="py-3 pr-4">
                    <p className="font-semibold text-gray-900">{i.label}</p>
                    <p className="text-xs text-gray-400">{i.intent}</p>
                  </td>
                  <td className="max-w-64 py-3 pr-4 text-gray-600">{i.description}</td>
                  <td className="max-w-72 py-3 pr-4 text-gray-600">{i.examples.map((e) => `“${e}”`).join(", ")}</td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </AdminShell>
  );
}
