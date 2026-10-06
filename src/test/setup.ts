// Vitest setup file — loaded once per test file via vite.config.ts `test.setupFiles`.
// Test files use explicit `import { ... } from "vitest"` (globals: false).
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// jsdom does not implement URL.createObjectURL / URL.revokeObjectURL.
// imageUtils.loadImageAsBlobUrl still relies on both for blob previews.
if (typeof URL.createObjectURL !== "function") {
  Object.defineProperty(URL, "createObjectURL", {
    value: vi.fn(() => `blob:mock-${Math.random().toString(36).slice(2)}`),
    writable: true,
    configurable: true,
  });
}
if (typeof URL.revokeObjectURL !== "function") {
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
}

// jsdom does not implement window.matchMedia, which Radix
// DropdownMenu / Popover / Tooltip query on mount.
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // deprecated API, still called by some libs
      removeListener: vi.fn(), // deprecated API, still called by some libs
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }),
  });
}
