"use client";

import { useEffect, useState } from "react";
import { fetchDevOtp } from "../../../lib/api";
import { TopBar } from "../../../components/TopBar";
import { KeyIcon } from "../../../components/icons";

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

export default function OtpConsolePage() {
  const [conversationId, setConversationId] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const last = window.localStorage.getItem("vn-last-conversation-id");
    if (last) setConversationId(last);
  }, []);

  async function lookup() {
    if (!conversationId.trim()) return;
    setLoading(true);
    setError(null);
    setCode(null);
    try {
      const result = await fetchDevOtp(conversationId.trim());
      setCode(result.code);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  if (!DEMO_MODE) {
    return (
      <>
        <TopBar eyebrow="OTP console" />
        <main className="mx-auto max-w-md px-6 py-10">
          <h1 className="text-2xl font-bold text-gray-900">OTP Console</h1>
          <p className="mt-2 text-sm text-gray-500">Not available — Demo Mode is off.</p>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar eyebrow="OTP console" />
      <main className="mx-auto max-w-md px-6 py-10">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
          <KeyIcon className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-2xl font-bold text-gray-900">OTP Console</h1>
        <p className="mt-1 text-sm text-gray-500">
          Dev-only plaintext OTP viewer — stands in for the SMS carrier during Demo Mode (ARCHITECTURE.md
          §8/§22). Never exposed to the AI or spoken on a call.
        </p>

        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <label htmlFor="cid" className="mb-2 block text-sm font-medium text-gray-700">
            Conversation ID
          </label>
          <div className="flex gap-2">
            <input
              id="cid"
              value={conversationId}
              onChange={(e) => setConversationId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && lookup()}
              placeholder="VN-000001"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={() => void lookup()}
              disabled={loading || !conversationId.trim()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Looking up…" : "Look up"}
            </button>
          </div>

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

          {code && (
            <div className="mt-4 rounded-lg bg-gray-50 p-4">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Code</span>
              <p className="mt-1 text-2xl font-bold tracking-widest text-gray-900">{code}</p>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
