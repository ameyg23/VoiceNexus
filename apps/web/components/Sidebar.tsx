"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark, GridIcon, PhoneIcon, GearIcon, ListIcon, LogoutIcon } from "./icons";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  soon?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: GridIcon },
  { label: "Calls", href: "/admin/dashboard", icon: PhoneIcon, soon: true },
  { label: "Reports", href: "/admin/dashboard", icon: ListIcon, soon: true },
  { label: "Settings", href: "/admin/dashboard", icon: GearIcon, soon: true },
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
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="flex items-center gap-2 px-5 py-5">
        <LogoMark className="h-7 w-7" />
        <span className="text-lg font-bold text-gray-900">VoiceNexus</span>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href && !item.soon;
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.soon ? "#" : item.href}
              aria-disabled={item.soon}
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition ${
                active
                  ? "bg-blue-50 text-blue-600"
                  : item.soon
                    ? "cursor-not-allowed text-gray-300"
                    : "text-gray-600 hover:bg-gray-50"
              }`}
              onClick={(e) => item.soon && e.preventDefault()}
            >
              <span className="flex items-center gap-2.5">
                <Icon className="h-4 w-4" />
                {item.label}
              </span>
              {item.soon && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-400">Sat</span>}
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
