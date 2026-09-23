import Link from "next/link";
import { LogoMark } from "./icons";

export function TopBar({ eyebrow }: { eyebrow?: string }) {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <LogoMark className="h-7 w-7" />
          <span className="text-lg font-bold text-gray-900">VoiceNexus</span>
        </Link>
        {eyebrow && (
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">{eyebrow}</span>
        )}
      </div>
    </header>
  );
}
