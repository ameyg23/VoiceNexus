"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LogoMark,
  GridIcon,
  PhoneIcon,
  GearIcon,
  ListIcon,
  LogoutIcon,
  UsersIcon,
  TargetIcon,
  EscalateIcon,
  LinkIcon,
  HeadsetIcon,
  KeyIcon,
  CalendarIcon,
} from "./icons";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: GridIcon },
  { label: "Calls", href: "/admin/calls", icon: PhoneIcon },
  { label: "Customers", href: "/admin/customers", icon: UsersIcon },
  { label: "Intents", href: "/admin/intents", icon: TargetIcon },
  { label: "Escalations", href: "/admin/escalations", icon: EscalateIcon },
  { label: "Callbacks", href: "/admin/follow-ups", icon: CalendarIcon },
  { label: "Reports", href: "/admin/reports", icon: ListIcon },
  { label: "Integrations", href: "/admin/integrations", icon: LinkIcon },
  { label: "Settings", href: "/admin/settings", icon: GearIcon },
];

// Testing tools. Demo call / OTP console open in a new tab so the dashboard stays put during a call.
const DEV_TOOLS: NavItem[] = [
  { label: "Test call", href: "/admin/test-call", icon: HeadsetIcon },
  { label: "Demo call", href: "/demo/call", icon: PhoneIcon },
  { label: "OTP console", href: "/demo/otp-console", icon: KeyIcon },
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

// Pinned on laptop widths; below that it's an off-canvas drawer opened from the shell's top bar.
export function Sidebar({
  orgName,
  employeeName,
  onLogout,
  open = false,
  onClose,
}: {
  orgName: string;
  employeeName: string;
  onLogout: () => void;
  open?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex h-dvh w-64 shrink-0 flex-col border-r border-gray-200 bg-white shadow-xl transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:translate-x-0 lg:shadow-none ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
      aria-label="Main navigation"
    >
      <div className="flex items-center justify-between gap-2 px-6 pb-6 pt-7">
        <span className="flex items-center gap-2.5">
          <LogoMark className="h-7 w-7" />
          <span className="text-xl font-bold tracking-tight text-gray-900">VoiceNexus</span>
        </span>
        {onClose && (
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600 lg:hidden" aria-label="Close menu">
            ✕
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-4">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.href}
              onClick={onClose}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-xl px-4 py-2.5 text-[15px] font-medium transition ${
                active ? "bg-brand-50 text-brand-700" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              <Icon className={`h-5 w-5 ${active ? "text-brand-600" : "text-gray-400"}`} />
              {item.label}
            </Link>
          );
        })}

        <p className="px-4 pb-1 pt-6 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Testing</p>
        {DEV_TOOLS.map((item) => {
          const Icon = item.icon;
          const external = item.href.startsWith("/demo");
          const active = isActive(item.href);
          const className = `flex items-center gap-3 rounded-xl px-4 py-2 text-sm font-medium transition ${
            active ? "bg-brand-50 text-brand-700" : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
          }`;
          return external ? (
            <a key={item.label} href={item.href} target="_blank" rel="noreferrer" className={className}>
              <Icon className="h-4 w-4 text-gray-400" />
              {item.label}
              <span className="ml-auto text-xs text-gray-300">↗</span>
            </a>
          ) : (
            <Link key={item.label} href={item.href} onClick={onClose} className={className}>
              <Icon className={`h-4 w-4 ${active ? "text-brand-600" : "text-gray-400"}`} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mx-4 mb-4 mt-2 flex items-center gap-3 border-t border-gray-100 px-2 pt-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">{initials(orgName)}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{orgName}</p>
          <p className="truncate text-xs text-gray-500">{employeeName}</p>
        </div>
        <button onClick={onLogout} title="Sign out" aria-label="Sign out" className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
          <LogoutIcon className="h-5 w-5" />
        </button>
      </div>
    </aside>
  );
}
