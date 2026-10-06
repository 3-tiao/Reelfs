import { Component, ErrorInfo, ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Root-level safety net: catches errors thrown during rendering, lifecycle
 * methods and constructors of the subtree and shows a recoverable fallback
 * instead of a blank window (a crash here would otherwise take down the whole
 * webview UI with no way back but killing the app).
 *
 * Mounted once in main.tsx around <App />; it deliberately uses no router
 * hooks so it keeps working even when the crash originates in the router tree.
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] Uncaught UI error:", error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-950 px-6 text-center text-white">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            The interface hit an unexpected error and stopped rendering.
            Reloading usually restores it.
          </p>
          <pre className="max-w-md overflow-auto rounded border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-left text-xs text-muted-foreground">
            {error.message}
          </pre>
          <button
            onClick={this.handleReload}
            className="rounded-full bg-white px-5 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
