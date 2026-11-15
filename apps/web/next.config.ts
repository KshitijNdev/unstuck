import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The floating dev badge sat over the stage HUD and landing controls; errors still surface without it.
  devIndicators: false,
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
