import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    window.location.href = '/dashboard';
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--color-bg-base, #F8FAFC)',
            color: 'var(--color-text-primary, #0F172A)',
            padding: '24px',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          <div
            style={{
              maxWidth: 480,
              width: '100%',
              background: 'var(--color-surface, #FFFFFF)',
              border: '1px solid var(--color-border-subtle, #E2E8F0)',
              borderRadius: 'var(--radius-xl, 20px)',
              padding: '32px 28px',
              textAlign: 'center',
              boxShadow: 'var(--shadow-xl, 0 20px 45px rgba(15, 23, 42, 0.12))',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: 'rgba(239, 68, 68, 0.12)',
                color: 'var(--color-danger, #EF4444)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AlertTriangle size={28} />
            </div>

            <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
              Something went wrong
            </h2>

            <p
              style={{
                fontSize: 13.5,
                color: 'var(--color-text-secondary, #64748B)',
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              An unexpected error occurred while loading this view. You can reload the page or return to Goat and Sheep Status (Katayuan ng Kambing at Tupa).
            </p>

            {this.state.error?.message && (
              <div
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  background: 'rgba(239, 68, 68, 0.06)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: 'var(--radius-md, 10px)',
                  fontSize: 12,
                  color: 'var(--color-danger, #EF4444)',
                  fontFamily: 'monospace',
                  textAlign: 'left',
                  wordBreak: 'break-word',
                  maxHeight: 100,
                  overflowY: 'auto',
                }}
              >
                {this.state.error.message}
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, width: '100%', marginTop: 8 }}>
              <button
                onClick={this.handleReload}
                style={{
                  flex: 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '10px 16px',
                  borderRadius: 'var(--radius-md, 10px)',
                  background: 'var(--color-primary, #238B45)',
                  color: '#FFFFFF',
                  fontWeight: 600,
                  fontSize: 13.5,
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                <RotateCcw size={15} />
                Reload
              </button>
              <button
                onClick={this.handleGoHome}
                style={{
                  flex: 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '10px 16px',
                  borderRadius: 'var(--radius-md, 10px)',
                  background: 'transparent',
                  border: '1px solid var(--color-border-subtle, #CBD5E1)',
                  color: 'var(--color-text-primary, #0F172A)',
                  fontWeight: 600,
                  fontSize: 13.5,
                  cursor: 'pointer',
                }}
              >
                <Home size={15} />
                Goat and Sheep Status (Katayuan ng Kambing at Tupa)
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
