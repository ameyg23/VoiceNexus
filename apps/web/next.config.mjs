import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A stray lockfile in the user's home directory (outside this repo) makes Next.js guess the
  // wrong monorepo root — pin it explicitly to silence the warning.
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
};

export default nextConfig;
