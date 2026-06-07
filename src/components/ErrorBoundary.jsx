import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="st-error-boundary">
          <div className="st-error-boundary-card">
            <h2>Something went wrong</h2>
            <p>
              An unexpected error occurred. Please refresh the page to continue.
            </p>
            <button type="button" className="st-export-btn" onClick={() => window.location.reload()}>
              Refresh Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
