import { describe, expect, it } from "vitest";
import { cn, formatBytes, formatDuration } from "../utils";

describe("formatBytes", () => {
  it("returns '0 B' for zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats sub-KB values without decimals", () => {
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(999)).toBe("999 B");
  });

  it("uses base-1000 progression across units", () => {
    expect(formatBytes(1000)).toBe("1 KB");
    expect(formatBytes(1500)).toBe("1.5 KB");
    expect(formatBytes(1_000_000)).toBe("1 MB");
    expect(formatBytes(1_048_576)).toBe("1.05 MB");
    expect(formatBytes(1e9)).toBe("1 GB");
    expect(formatBytes(1e12)).toBe("1 TB");
  });

  it("trims trailing zeros from decimals", () => {
    expect(formatBytes(2500)).toBe("2.5 KB");
    expect(formatBytes(1_500_000)).toBe("1.5 MB");
    expect(formatBytes(1.5e12)).toBe("1.5 TB");
  });

  it("stays inside the sizes array at PB scale", () => {
    expect(formatBytes(1e15)).toBe("1 PB");
    expect(formatBytes(1e16)).toBe("10 PB");
  });
});

describe("formatDuration", () => {
  it("renders minutes only below one hour", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(59)).toBe("0m");
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(599)).toBe("9m");
    expect(formatDuration(3599)).toBe("59m");
  });

  it("renders 'Xh Ym' at or above one hour", () => {
    expect(formatDuration(3600)).toBe("1h 0m");
    expect(formatDuration(3660)).toBe("1h 1m");
    expect(formatDuration(7325)).toBe("2h 2m");
    expect(formatDuration(86399)).toBe("23h 59m");
  });
});

describe("cn", () => {
  it("drops falsy conditional inputs", () => {
    expect(cn("a", false && "b", undefined, null, "c")).toBe("a c");
    expect(cn()).toBe("");
  });

  it("keeps non-conflicting classes together", () => {
    expect(cn("px-2", "py-2")).toBe("px-2 py-2");
  });

  it("lets later classes win same-group conflicts", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("resolves conflicts per variant independently", () => {
    expect(cn("hover:text-red-500", "text-blue-500", "hover:text-blue-500")).toBe(
      "text-blue-500 hover:text-blue-500",
    );
  });
});
