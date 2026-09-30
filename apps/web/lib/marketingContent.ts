import { WaveformIcon, HeadsetIcon, CheckIcon, UsersIcon, GearIcon, LockIcon } from "../components/icons";

// Shared marketing content for the public homepage (/) and the authenticated get-started page -
// identical for an anonymous visitor and a logged-in prospect, so this is the single source of
// truth (extracted Sep 30 when the public homepage was added, to keep the two pages from drifting).

export const FEATURES = [
  { icon: WaveformIcon, title: "Speeds up to 1 Gig", body: "Fiber-fast downloads and uploads for every device, at home or in the office, no slowdowns at peak hours." },
  { icon: HeadsetIcon, title: "24/7 automated support", body: "Call any time, day or night, and get help in seconds - a live agent is always one ask away." },
  { icon: CheckIcon, title: "No contracts, no surprises", body: "Simple monthly pricing, cancel any time. No hidden fees, no early-termination charges." },
  { icon: UsersIcon, title: "Local technicians", body: "Need a hand at home or on-site at your business? We'll get someone out to you, usually within the week." },
  { icon: GearIcon, title: "Free professional installation", body: "We set up and test your connection so it works the way it should from day one." },
  { icon: LockIcon, title: "A connection you can count on", body: "Dedicated fiber and a proactively monitored network, built to stay reliable when it matters most." },
];

// Illustrative trust-signal numbers for the demo (Springfield Fiber is a fictional company - not
// pulled from any real filing), styled after the quick stats strip on fidiumfiber.com.
export const STATS = [
  { value: "50K+", label: "Homes & businesses connected" },
  { value: "1 Gig", label: "Max download speed" },
  { value: "24/7", label: "Always-on support" },
  { value: "99.9%", label: "Network uptime" },
];

// A dark, plain-text band (no icons/cards) for visual variety against the light sections around it -
// loosely mirrors fidiumfiber.com's "How people use Fidium Fiber at home" band, adapted to cover
// business use too since this content serves both audiences.
export const USE_CASES = [
  { title: "Gaming without lag", body: "Low latency and consistent speeds keep gameplay smooth, even during peak hours." },
  { title: "Work and school at the same time", body: "Fast uploads make video calls clearer and file sharing quicker, even with everyone online at once." },
  { title: "Streaming everywhere", body: "Stream in 4K across multiple devices without buffering or slowdowns." },
  { title: "Always-on for business", body: "A static IP and priority support keep point-of-sale, calls, and cloud tools running without a hitch." },
];

// Frontend-only marketing labels, not part of PLAN_CATALOG (the phone AI's plan list stays
// unlabeled - "Most Popular" means nothing read aloud). Picked on real value: the mid-tier plan
// balances speed/price, the top tier is the biggest speed jump per dollar.
export const PLAN_BADGES: Record<string, string> = {
  "Fiber 500": "Most Popular",
  "Fiber 1000": "Best Value",
  "Business 500": "Most Popular",
  "Business 1000": "Best Value",
};

// Customer promises - what we commit to on every account, grounded in real features elsewhere on
// the page (installation, wifi setup, 24/7 support, no contracts, live-agent access), not new claims.
export const PROMISES = [
  { title: "Every install, tested and confirmed", body: "We confirm your connection at setup so you know you're getting the speed you're paying for." },
  { title: "Whole-home wifi, set up for you", body: "We test your wifi coverage at install so there are no dead zones from day one." },
  { title: "24/7 support, real help when you need it", body: "Automated help around the clock, with a live agent always one ask away." },
  { title: "No contracts, ever", body: "Month-to-month pricing. Cancel any time, no early-termination fees." },
  { title: "A network we watch around the clock", body: "Proactively monitored to catch issues before they reach you." },
  { title: "Ask for a person, any time", body: "Say the word during any call and you're transferred right away, no waiting in a queue." },
];

// Standard fiber-vs-cable/DSL marketing points (real, well-known technical differences - fiber is
// genuinely not shared with the neighborhood and isn't weather-sensitive the way copper/coax is).
export const COMPARISON = [
  { label: "Upload speeds", fiber: "As fast as downloads", regular: "Often much slower" },
  { label: "Peak-hour slowdowns", fiber: "None, your line isn't shared", regular: "Common, shared with the neighborhood" },
  { label: "Affected by weather", fiber: "No", regular: "Can drop in storms" },
  { label: "Contract required", fiber: "No, cancel any time", regular: "Often 1-2 years" },
];

export const GET_STARTED_FAQS: { q: string; a: string }[] = [
  { q: "Is Springfield Fiber available in my area?", a: "In most covered ZIP codes, yes. Use the ZIP checker above for an instant answer, or call the number below and our assistant can check it for you." },
  { q: "Are there contracts or data caps?", a: "No. Every plan is month-to-month with unlimited data. Cancel any time, no early-termination fees." },
  { q: "What's included when I sign up?", a: "Free professional installation, a wifi router, and 24/7 automated support that can connect you to a live agent any time you need one." },
  { q: "How is a business plan different?", a: "Business plans add a static IP and priority support on the same fiber network, at business-tier pricing." },
  { q: "Can I speak to a live person?", a: "Yes, any time. Just ask for an agent during your call and you'll be transferred with a summary of what you've already told us, so you don't have to repeat yourself." },
];
