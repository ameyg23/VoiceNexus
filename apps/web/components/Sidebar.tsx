"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark, GridIcon, PhoneIcon, GearIcon, ListIcon, LogoutIcon, UsersIcon, LinkIcon } from "./icons";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

// Lean ops nav: Escalations lives inside the Dashboard (a card there links through to
// /admin/escalations, which still exists as its own full page); Intents, Callbacks and the
// Test call/Demo call testing tools were dropped from here entirely — intents stay a backend-only
// concept, and the testing tools aren't something an ops agent needs (still reachable directly at
// /admin/test-call and /demo/call for development use).
const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: GridIcon },
  { label: "Calls", href: "/admin/calls", icon: PhoneIcon },
  { label: "Customers", href: "/admin/customers", icon: UsersIcon },
  { label: "Reports", href: "/admin/reports", icon: ListIcon },
  { label: "Integrations", href: "/admin/integrations", icon: LinkIcon },
  { label: "Settings", href: "/admin/settings", icon: GearIcon },
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
      className={`fixed inset-y-0 left-0 z-40 flex h-dvh w-64 shrink-0 flex-col bg-ink-950 shadow-xl transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:translate-x-0 lg:shadow-none ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
      aria-label="Main navigation"
    >
      <div className="flex items-center justify-between gap-2 px-6 pb-6 pt-7">
        <span className="flex items-center gap-2.5">
          <LogoMark className="h-7 w-7" />
          <span className="text-xl font-bold tracking-tight text-white">VoiceNexus</span>
        </span>
        {onClose && (
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-500 hover:bg-white/10 hover:text-white lg:hidden" aria-label="Close menu">
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
              className={`flex items-center gap-3 rounded-xl border-l-2 px-4 py-2.5 text-[15px] font-medium transition ${
                active ? "border-brand-600 bg-white/5 text-white" : "border-transparent text-gray-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon className={`h-5 w-5 ${active ? "text-brand-500" : "text-gray-500"}`} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mx-4 mb-4 mt-2 flex items-center gap-3 border-t border-white/10 px-2 pt-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">{initials(orgName)}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{orgName}</p>
          <p className="truncate text-xs text-gray-400">{employeeName}</p>
        </div>
        <button onClick={onLogout} title="Sign out" aria-label="Sign out" className="shrink-0 rounded-lg p-1.5 text-gray-500 hover:bg-white/10 hover:text-white">
          <LogoutIcon className="h-5 w-5" />
        </button>
      </div>
    </aside>
  );
}
