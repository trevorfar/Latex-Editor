import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Docker image runs the minimal standalone server; Vercel uses its own output.
  output: process.env.STANDALONE === "1" ? "standalone" : undefined,
};

export default nextConfig;
