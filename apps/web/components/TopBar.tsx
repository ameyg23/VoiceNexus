import Link from "next/link";
import { LogoMark } from "./icons";

export function TopBar({ eyebrow }: { eyebrow?: string }) {
  return (
    <header className="bg-ink-950">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <LogoMark className="h-7 w-7" />
          <span className="text-lg font-bold text-white">VoiceNexus</span>
        </Link>
        {eyebrow && (
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-gray-300">{eyebrow}</span>
        )}
      </div>
      <div className="h-[3px] bg-brand-600" />
    </header>
  );
}
