import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, retry: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Error boundary component specifically for worker pool initialization failures.
 * Provides retry capability and graceful error handling.
 */
export class WorkerErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log the error to console for debugging
    console.error('Worker Error Boundary caught an error:', error, errorInfo);
    
    // Update state with error info
    this.setState({
      error,
      errorInfo
    });
    
    // Check if this is a worker-related error
    if (this.isWorkerError(error)) {
      console.error('Worker pool initialization failed. User can retry manually.');
    }
  }

  private isWorkerError(error: Error): boolean {
    const errorMessage = error.message.toLowerCase();
    return (
      errorMessage.includes('worker') ||
      errorMessage.includes('pool') ||
      errorMessage.includes('initialization') ||
      errorMessage.includes('tree builder')
    );
  }

  private handleRetry = () => {
    // Reset error state to retry rendering
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.handleRetry);
      }

      // Default fallback UI
      return (
        <div className="error-boundary-container p-4 m-4 bg-red-50 border border-red-200 rounded-lg">
          <h2 className="text-lg font-semibold text-red-800 mb-2">
            Worker Initialization Error
          </h2>
          <p className="text-red-600 mb-4">
            {this.isWorkerError(this.state.error)
              ? 'Failed to initialize the worker pool for processing files. This might be due to browser restrictions or resource limitations.'
              : 'An unexpected error occurred while initializing the application.'}
          </p>
          <details className="mb-4">
            <summary className="cursor-pointer text-red-700 hover:text-red-900">
              Error Details
            </summary>
            <pre className="mt-2 p-2 bg-red-100 rounded text-xs overflow-auto">
              {this.state.error.toString()}
              {this.state.errorInfo && (
                <>
                  {'\n\nComponent Stack:\n'}
                  {this.state.errorInfo.componentStack}
                </>
              )}
            </pre>
          </details>
          <button
            onClick={this.handleRetry}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
          >
            Retry Initialization
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Higher-order component to wrap components that use worker pools
 */
export function withWorkerErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  fallback?: (error: Error, retry: () => void) => ReactNode
): React.ComponentType<P> {
  const WrappedComponent = (props: P) => (
    <WorkerErrorBoundary fallback={fallback}>
      <Component {...props} />
    </WorkerErrorBoundary>
  );
  
  WrappedComponent.displayName = `WithWorkerErrorBoundary(${Component.displayName || Component.name || 'Component'})`;
  
  return WrappedComponent;
}