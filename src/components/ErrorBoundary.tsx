import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    // The message can carry file paths, hostnames, or upstream API text, so it
    // is never rendered. The thrown value already reaches error reporting.
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main>
          <h2>Something went wrong.</h2>
          <p>
            The page hit an error and stopped. Refresh to try again. If it keeps
            failing, the scan service may be unavailable.
          </p>
        </main>
      );
    }
    return this.props.children;
  }
}
