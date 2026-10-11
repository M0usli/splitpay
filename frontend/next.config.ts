import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Inside Docker on Windows/macOS, file-change events from the host don't
  // reach the container, so the dev server checks for changes on a timer.
  // compose.yaml sets DEV_FILE_POLLING; outside Docker this stays off.
  watchOptions: process.env.DEV_FILE_POLLING
    ? { pollIntervalMs: 1000 }
    : undefined,
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
