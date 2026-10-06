// Smoke test for the test infrastructure itself — no business modules involved.
// Verifies: vitest runs, jsdom environment is active, the setup-file stubs are
// in place, jest-dom matchers are installed, and the "@" alias resolves.
import { describe, expect, it } from "vitest";

describe("test infrastructure smoke", () => {
  it("runs inside jsdom (window and document exist)", () => {
    expect(typeof window).toBe("object");
    expect(typeof document.createElement).toBe("function");
  });

  it("has jest-dom matchers installed via setup.ts", () => {
    const el = document.createElement("div");
    el.textContent = "hello";
    document.body.appendChild(el);
    expect(el).toBeInTheDocument();
  });

  it("has window.matchMedia stubbed for Radix components", () => {
    const mql = window.matchMedia("(min-width: 100px)");
    expect(mql.matches).toBe(false);
    expect(mql.media).toBe("(min-width: 100px)");
  });

  it("has a usable URL.createObjectURL / revokeObjectURL for imageUtils blob previews", () => {
    // jsdom >= 29 implements these natively; setup.ts only stubs them when missing.
    const url = URL.createObjectURL(new Blob(["x"]));
    expect(url).toMatch(/^blob:/);
    expect(() => URL.revokeObjectURL(url)).not.toThrow();
  });

  it("resolves the '@' alias from vite.config.ts", async () => {
    const self = await import("@/test/smoke.test");
    expect(self).toBeDefined();
  });
});
