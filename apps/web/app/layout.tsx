import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voice Nexus",
  description: "AI IVR platform POC",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-gray-900">{children}</body>
    </html>
  );
}
