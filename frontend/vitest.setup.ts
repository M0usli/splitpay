// Runs before every test file.
import "@testing-library/jest-dom/vitest"; // adds checks such as toBeInTheDocument()
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Remove whatever the previous test rendered, so tests cannot affect each other.
afterEach(() => {
  cleanup();
});
