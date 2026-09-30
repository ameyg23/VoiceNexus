"use client";

import { useState } from "react";
import { ArrowRightIcon } from "./icons";

// Shared accordion used by the public homepage, get-started, and the portal account page - same
// interaction pattern, different question sets per page.
export function FaqAccordion({ faqs }: { faqs: { q: string; a: string }[] }) {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  return (
    <div className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      {faqs.map((item, i) => {
        const open = openFaq === i;
        return (
          <div key={item.q}>
            <button
              onClick={() => setOpenFaq(open ? null : i)}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-semibold text-gray-900 hover:bg-gray-50"
              aria-expanded={open}
            >
              {item.q}
              <ArrowRightIcon className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? "rotate-90" : ""}`} />
            </button>
            {open && <p className="px-5 pb-4 text-sm leading-relaxed text-gray-600">{item.a}</p>}
          </div>
        );
      })}
    </div>
  );
}
