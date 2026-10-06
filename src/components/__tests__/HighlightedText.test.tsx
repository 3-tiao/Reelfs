// Lightweight render tests for src/components/HighlightedText.tsx.
//
// The component only calls getHighlightedParts from ../lib/search, and that
// module reaches ../services/tauri via a type-only import (search.ts:1) that is
// erased before execution — so no Tauri runtime is in this test's module graph.
// The @tauri-apps/api mocks are defensive, per test policy.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import HighlightedText from "../HighlightedText";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

// vitest runs with globals:false (vite.config.ts), so @testing-library/react
// cannot auto-register cleanup through the global afterEach — do it explicitly.
afterEach(cleanup);

describe("HighlightedText", () => {
  it("returns null when text is null, undefined or empty (HighlightedText.tsx:16-18)", () => {
    const empty = render(<HighlightedText text="" query="matrix" />);
    expect(empty.container.firstChild).toBeNull();

    const nil = render(<HighlightedText text={null} query="matrix" />);
    expect(nil.container.firstChild).toBeNull();

    const missing = render(<HighlightedText query="matrix" />);
    expect(missing.container.firstChild).toBeNull();
  });

  it("wraps matched fragments in the default highlight class and leaves others plain", () => {
    const { container } = render(<HighlightedText text="The Matrix" query="matrix" />);

    // Wrapper span + one span per part.
    expect(container.querySelectorAll("span")).toHaveLength(3);
    expect(screen.getByText("The")).not.toHaveClass("bg-white/15");
    const matched = screen.getByText("Matrix");
    expect(matched).toHaveClass("bg-white/15", "text-foreground", "rounded", "px-0.5");
  });

  it("uses the custom highlightClassName when provided", () => {
    render(
      <HighlightedText text="The Matrix" query="matrix" highlightClassName="text-red-500" />,
    );

    const matched = screen.getByText("Matrix");
    expect(matched).toHaveClass("text-red-500");
    expect(matched).not.toHaveClass("bg-white/15");
  });

  it("applies className to the outer wrapper span", () => {
    const { container } = render(
      <HighlightedText text="The Matrix" query="matrix" className="movie-title" />,
    );

    expect(container.firstChild).toHaveClass("movie-title");
    // The highlight class stays on the matched inner span, not the wrapper.
    expect(screen.getByText("Matrix")).toHaveClass("bg-white/15");
  });

  it("renders a single plain span when the query yields no usable terms", () => {
    const { container } = render(<HighlightedText text="Star Wars" query="!!! ???" />);

    // Wrapper + one unmatched child carrying the full text.
    expect(container.querySelectorAll("span")).toHaveLength(2);
    const child = container.querySelector("span > span");
    expect(child).not.toBeNull();
    expect(child).not.toHaveClass("bg-white/15");
    expect(child).toHaveTextContent("Star Wars");
  });
});
