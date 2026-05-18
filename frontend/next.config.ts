import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: [process.env.APP_DOMAIN || "localhost"],
  turbopack: {
    resolveAlias: { canvas: "./empty-module.js" },
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    staleTimes: { dynamic: 0, static: 0 },
  },
  headers: async () => [
    {
      source: "/(.*)",
      headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
    },
  ],
};

export default nextConfig;
