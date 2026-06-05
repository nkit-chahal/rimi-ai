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
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '100vh', background: '#0a0a0f', color: '#e4e4e7', fontFamily: 'Inter, system-ui, sans-serif',
          padding: '2rem', textAlign: 'center'
        }}>
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '16px', padding: '2rem 3rem', maxWidth: '500px'
          }}>
            <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', color: '#f87171' }}>Something went wrong</h2>
            <p style={{ margin: '0 0 1.5rem', color: '#a1a1aa', fontSize: '0.875rem' }}>
              An unexpected error occurred. Please refresh the page to continue.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: 'white',
                border: 'none', borderRadius: '10px', padding: '10px 24px',
                fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer'
              }}
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
