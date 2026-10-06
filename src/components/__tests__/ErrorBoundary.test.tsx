// Unit tests for src/components/ErrorBoundary.tsx.
//
// ErrorBoundary is a pure React class component with no Tauri dependencies,
// but the @tauri-apps/api mocks are defensive, per test policy. React logs
// caught boundary errors through console.error — silenced per test to keep
// the output readable.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ErrorBoundary from "../ErrorBoundary";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

// vitest runs with globals:false (vite.config.ts), so @testing-library/react
// cannot auto-register cleanup through the global afterEach — do it explicitly.
afterEach(cleanup);

function Bomber({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("kaboom");
  }
  return <div>safe child</div>;
}

describe("ErrorBoundary", () => {
  let consoleErrorSpy: MockInstance;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("renders children untouched when nothing throws", () => {
    render(
      <ErrorBoundary>
        <Bomber shouldThrow={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("safe child")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("catches a child render error and shows the fallback with the message", () => {
    // Render is split so the boundary flips from happy path to error path —
    // mirroring how the mounted boundary wraps an already-rendered app.
    const { rerender } = render(
      <ErrorBoundary>
        <Bomber shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("safe child")).toBeInTheDocument();

    rerender(
      <ErrorBoundary>
        <Bomber shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("kaboom")).toBeInTheDocument();
    // The crashed subtree is gone, not rendered alongside the fallback.
    expect(screen.queryByText("safe child")).not.toBeInTheDocument();
  });

  it("logs the caught error through componentDidCatch", () => {
    const { rerender } = render(
      <ErrorBoundary>
        <Bomber shouldThrow={false} />
      </ErrorBoundary>,
    );

    rerender(
      <ErrorBoundary>
        <Bomber shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(consoleErrorSpy).toHaveBeenCalled();
    const logged = consoleErrorSpy.mock.calls.map((args) => String(args[0]));
    expect(logged.some((msg) => msg.includes("[ErrorBoundary]"))).toBe(true);
  });

  it("reloads the window from the fallback button", async () => {
    // jsdom's Location methods are non-configurable, so vi.spyOn cannot stub
    // them; swap the whole location object instead (the standard jsdom pattern).
    const windowWithLocation = window as unknown as { location: Location };
    const originalLocation = windowWithLocation.location;
    const reload = vi.fn();
    // @ts-expect-error jsdom allows deleting and replacing window.location in tests
    delete window.location;
    windowWithLocation.location = { reload } as unknown as Location;

    try {
      const { rerender } = render(
        <ErrorBoundary>
          <Bomber shouldThrow={false} />
        </ErrorBoundary>,
      );
      rerender(
        <ErrorBoundary>
          <Bomber shouldThrow={true} />
        </ErrorBoundary>,
      );

      await userEvent.click(screen.getByRole("button", { name: "Reload" }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      windowWithLocation.location = originalLocation;
    }
  });
});
