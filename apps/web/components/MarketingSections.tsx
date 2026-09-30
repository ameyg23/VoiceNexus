import { STATS, FEATURES, PROMISES, COMPARISON, USE_CASES } from "../lib/marketingContent";
import { CheckIcon } from "./icons";

// Shared marketing block used by both the public homepage (/) and the authenticated get-started
// page - stats/features/promise/comparison/use-cases/photo band are identical for an anonymous
// visitor and a logged-in prospect, so this is the single source of truth for that content
// (extracted Sep 30 when the public homepage was added, to keep the two pages from drifting apart).
export function MarketingSections() {
  return (
    <>
      {/* Stats band - styled after Fidium's colorful stat-strip treatment. */}
      <section className="bg-gradient-to-br from-brand-600 to-brand-800">
        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-6 px-4 py-8 sm:px-6 lg:grid-cols-4 lg:gap-4">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <p className="text-2xl font-bold text-white sm:text-3xl">{s.value}</p>
              <p className="mt-1 text-xs text-white/80 sm:text-sm">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Why us */}
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <section>
          <span className="kicker">Why Springfield Fiber</span>
          <h2 className="mt-2 text-lg font-bold text-gray-900">Everything you'd expect, nothing you wouldn't</h2>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-semibold text-gray-900">{title}</p>
                  <p className="mt-1 text-sm text-gray-500">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* The Springfield Promise + fiber vs. regular comparison. */}
      <section className="bg-brand-50/60 py-12">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <span className="kicker">The Springfield Promise</span>
          <h2 className="mt-2 text-2xl font-bold text-gray-900">What we promise, every time.</h2>
          <div className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {PROMISES.map((p) => (
              <div key={p.title} className="flex items-start gap-3">
                <CheckIcon className="mt-1 h-4 w-4 shrink-0 text-brand-600" />
                <div>
                  <p className="font-semibold text-gray-900">{p.title}</p>
                  <p className="mt-1 text-sm text-gray-600">{p.body}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12">
            <span className="kicker">Fiber vs. traditional internet</span>
            <h2 className="mt-2 text-2xl font-bold text-gray-900">Not all internet is built the same.</h2>
            <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="grid grid-cols-3 border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <div className="px-3 py-3 sm:px-4"></div>
                <div className="px-3 py-3 text-brand-600 sm:px-4">Springfield Fiber</div>
                <div className="px-3 py-3 sm:px-4">Cable/DSL</div>
              </div>
              {COMPARISON.map((row, i) => (
                <div key={row.label} className={`grid grid-cols-3 text-xs sm:text-sm ${i !== COMPARISON.length - 1 ? "border-b border-gray-100" : ""}`}>
                  <div className="px-3 py-3 font-medium text-gray-900 sm:px-4">{row.label}</div>
                  <div className="px-3 py-3 text-gray-700 sm:px-4">{row.fiber}</div>
                  <div className="px-3 py-3 text-gray-500 sm:px-4">{row.regular}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How people use it - a dark, plain-text band for visual contrast. */}
      <section className="bg-ink-950 py-12 text-white">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <h2 className="text-2xl font-bold">
            How people use <span className="text-brand-500">Springfield Fiber.</span>
          </h2>
          <div className="mt-6 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {USE_CASES.map((u) => (
              <div key={u.title}>
                <p className="font-semibold text-white">{u.title}</p>
                <p className="mt-1.5 text-sm text-gray-400">{u.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Connected everywhere - a second real photo, feature-with-photo band (Fidium-style). */}
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="grid gap-0 sm:grid-cols-2 sm:items-center">
            <img
              src="https://images.unsplash.com/photo-1620862657788-a403bdf6dd63?w=900&q=80&auto=format&fit=crop"
              alt="A woman relaxing on her couch, working on a laptop over wifi at home"
              className="h-56 w-full object-cover sm:h-full"
            />
            <div className="p-6 sm:p-8">
              <span className="kicker">Wifi built to keep up</span>
              <h2 className="mt-2 text-lg font-bold text-gray-900">Work, stream, and connect without the dead zones</h2>
              <p className="mt-2 text-sm text-gray-600">
                Reliable coverage from wall to wall, whether it's a home office, a full house, or a small business floor.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-gray-600">
                <li className="flex items-start gap-2">
                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> Free wifi router included with every plan
                </li>
                <li className="flex items-start gap-2">
                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> Set up the same day service is installed
                </li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
