import Link from "next/link";
import { TopBar } from "../components/TopBar";
import { PersonIcon, KeyIcon, ArrowRightIcon, GridIcon } from "../components/icons";

function LaunchCard({
  href,
  icon,
  iconBg,
  iconColor,
  title,
  description,
  cta,
}: {
  href: string;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  title: string;
  description: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition hover:border-blue-300 hover:shadow-md"
    >
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconBg} ${iconColor}`}>{icon}</div>
      <h2 className="mt-4 text-base font-semibold text-gray-900">{title}</h2>
      <p className="mt-1 text-sm text-gray-500">{description}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-blue-600">
        {cta} <ArrowRightIcon className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

export default function Home() {
  return (
    <>
      <TopBar eyebrow="Proof of concept" />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-bold text-gray-900">Voice Nexus</h1>
        <p className="mt-1 text-sm text-gray-500">AI IVR platform — pick a page to try.</p>

        <h3 className="mt-8 text-xs font-semibold uppercase tracking-wide text-gray-400">Customer portal</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <LaunchCard
            href="/portal/signup"
            icon={<PersonIcon className="h-5 w-5" />}
            iconBg="bg-blue-50"
            iconColor="text-blue-600"
            title="Create an account"
            description="Sign up for account balance, plan, and billing self-service — sets your phone PIN too."
            cta="Sign up"
          />
          <LaunchCard
            href="/portal/login"
            icon={<PersonIcon className="h-5 w-5" />}
            iconBg="bg-blue-50"
            iconColor="text-blue-600"
            title="Sign in"
            description="Already have a portal account? View your balance, plan, and account status."
            cta="Sign in"
          />
        </div>

        <h3 className="mt-8 text-xs font-semibold uppercase tracking-wide text-gray-400">Employee ops</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <LaunchCard
            href="/admin/signup"
            icon={<GridIcon className="h-5 w-5" />}
            iconBg="bg-indigo-50"
            iconColor="text-indigo-600"
            title="Employee signup"
            description="Create an ops-dashboard account for Springfield Fiber."
            cta="Sign up"
          />
          <LaunchCard
            href="/admin/login"
            icon={<GridIcon className="h-5 w-5" />}
            iconBg="bg-indigo-50"
            iconColor="text-indigo-600"
            title="Employee login"
            description="Dashboard summary today; calls/intents/escalations/reports land Saturday."
            cta="Sign in"
          />
        </div>

        <h3 className="mt-8 text-xs font-semibold uppercase tracking-wide text-gray-400">Demo &amp; dev tools</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <LaunchCard
            href="/demo/call"
            icon={<PersonIcon className="h-5 w-5" />}
            iconBg="bg-blue-50"
            iconColor="text-blue-600"
            title="Demo call"
            description="Simulate an inbound customer call in-browser — mic or typed input, live auth flow."
            cta="Start a call"
          />
          <LaunchCard
            href="/demo/otp-console"
            icon={<KeyIcon className="h-5 w-5" />}
            iconBg="bg-amber-50"
            iconColor="text-amber-600"
            title="OTP console"
            description="Dev-only plaintext OTP viewer — stands in for the SMS carrier during Demo Mode."
            cta="Open console"
          />
        </div>
      </main>
    </>
  );
}
