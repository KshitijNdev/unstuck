import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The floating dev badge sat over the stage HUD and landing controls; errors still surface without it.
  devIndicators: false,
  // Next 16 dev serves /_next/* only to localhost by default; without this, 127.0.0.1 gets 403s and never hydrates.
  allowedDevOrigins: ["127.0.0.1"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
