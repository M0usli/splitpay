import type { NextConfig } from "next";

// To open the app from a phone, PHONE_ORIGIN in .env holds this computer's
// network address, for example http://192.168.1.20:3000. The dev server
// only answers the hostnames it knows, so that hostname is added here.
const phoneHostname = process.env.PHONE_ORIGIN
  ? new URL(process.env.PHONE_ORIGIN).hostname
  : null;

const nextConfig: NextConfig = {
  allowedDevOrigins: phoneHostname === null ? [] : [phoneHostname],
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
