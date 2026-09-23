import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A stray lockfile in the user's home directory (outside this repo) makes Next.js guess the
  // wrong monorepo root — pin it explicitly to silence the warning.
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  // One sign-in/sign-up for everyone (the server decides employee vs customer). The home page is
  // the sign-in page, and the old per-audience URLs point at the unified ones.
  async redirects() {
    return [
      { source: "/", destination: "/login", permanent: false },
      { source: "/admin/login", destination: "/login", permanent: false },
      { source: "/portal/login", destination: "/login", permanent: false },
      { source: "/admin/signup", destination: "/signup", permanent: false },
      { source: "/portal/signup", destination: "/signup", permanent: false },
    ];
  },
};

export default nextConfig;
