import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from '@/tracker/components/ui/EmptyState';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-lg p-6">
          <ErrorState title="Something broke on this screen" message="Your saved records are not affected. Reload the page to continue." onRetry={() => location.reload()} />
        </div>
      );
    }
    return this.props.children;
  }
}
