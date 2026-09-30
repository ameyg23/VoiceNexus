import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A stray lockfile in the user's home directory (outside this repo) makes Next.js guess the
  // wrong monorepo root — pin it explicitly to silence the warning.
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  // "/" is a real public page again (app/page.tsx, Sep 30 - see its own top comment for why this is
  // the third time this exact structure has been tried this week). One shared sign-in for everyone
  // still lives at /login (the server decides employee vs customer and redirects accordingly).
  async redirects() {
    return [
      { source: "/admin/login", destination: "/login", permanent: false },
      { source: "/portal/login", destination: "/login", permanent: false },
      { source: "/admin/signup", destination: "/signup", permanent: false },
      { source: "/portal/signup", destination: "/signup", permanent: false },
      // Customer care used to be a separate sub-page; it's now a section on /portal/account itself.
      { source: "/portal/support", destination: "/portal/account", permanent: false },
      // Admin-panel consolidation: Intents and Callbacks were dropped from the UI (intents stay a
      // backend-only concept). Escalations was NOT removed — /admin/escalations still works, it's
      // just reached via the Dashboard's escalation card instead of a sidebar link.
      { source: "/admin/intents", destination: "/admin/dashboard", permanent: false },
      { source: "/admin/follow-ups", destination: "/admin/dashboard", permanent: false },
    ];
  },
};

export default nextConfig;
