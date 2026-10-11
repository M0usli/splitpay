import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Makes the "@/..." import shortcut from tsconfig.json work in tests too.
  resolve: { tsconfigPaths: true },
  test: {
    // jsdom is a pretend browser, so components can render without a real one.
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
