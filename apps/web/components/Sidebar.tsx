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
  { label: "Reports", href: "/admin/reports", icon: ListIcon },
  { label: "Integrations", href: "/admin/integrations", icon: LinkIcon },
  { label: "Test Call", href: "/admin/test-call", icon: HeadsetIcon },
  { label: "Settings", href: "/admin/settings", icon: GearIcon },
];

export function Sidebar({
  orgName,
  employeeName,
  onLogout,
}: {
  orgName: string;
  employeeName: string;
  onLogout: () => void;
}) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="flex items-center gap-2 px-5 py-5">
        <LogoMark className="h-7 w-7" />
        <span className="text-lg font-bold text-gray-900">VoiceNexus</span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.href}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                active ? "bg-blue-50 text-blue-600" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-2 border-t border-gray-200 px-5 py-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
          {employeeName.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-900">{employeeName}</p>
          <p className="truncate text-xs text-gray-400">{orgName}</p>
        </div>
        <button onClick={onLogout} title="Sign out" className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600">
          <LogoutIcon className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
