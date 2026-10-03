import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main>
          <h2>Something went wrong.</h2>
          <p>Please refresh the page. If it keeps failing, the scan service may be unavailable.</p>
          <p><code>{this.state.error.message}</code></p>
        </main>
      );
    }
    return this.props.children;
  }
}
