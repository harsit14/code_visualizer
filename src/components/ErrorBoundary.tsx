import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

type ErrorBoundaryProps = {
  children: ReactNode;
  className?: string;
  resetKeys?: readonly unknown[];
  title: string;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export function didResetKeysChange(
  previous: readonly unknown[] = [],
  current: readonly unknown[] = [],
): boolean {
  return (
    previous.length !== current.length ||
    previous.some((previousKey, index) => !Object.is(previousKey, current[index]))
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Failed to render ${this.props.title}`, error, info);
  }

  componentDidUpdate(previousProps: ErrorBoundaryProps) {
    if (this.state.error && didResetKeysChange(previousProps.resetKeys, this.props.resetKeys)) {
      this.setState({ error: null });
    }
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <section
        className={['panel', 'error-boundary-panel', this.props.className]
          .filter(Boolean)
          .join(' ')}
        aria-label={`${this.props.title} unavailable`}
      >
        <header className="panel-header">
          <h2>
            <AlertTriangle size={14} /> {this.props.title}
          </h2>
          <span className="panel-hint">render paused</span>
        </header>
        <div className="panel-error-body" role="alert">
          <p>This panel could not render the current trace state.</p>
          <button className="ghost-button" onClick={this.reset} type="button">
            Try again
          </button>
        </div>
      </section>
    );
  }
}
