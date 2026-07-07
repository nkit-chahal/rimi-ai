export async function initObservability() {
  const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
  if (sentryDsn) {
    try {
      const Sentry = await import('@sentry/react');
      Sentry.init({
        dsn: sentryDsn,
        integrations: [Sentry.browserTracingIntegration()],
        tracesSampleRate: 0.1,
      });
    } catch (err) {
      console.warn('Sentry init failed:', err);
    }
  }

  const posthogKey = import.meta.env.VITE_POSTHOG_KEY;
  if (posthogKey && typeof window !== 'undefined') {
    try {
      const { default: posthog } = await import('posthog-js');
      posthog.init(posthogKey, {
        api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com',
        capture_pageview: true,
      });
      window.posthog = posthog;
    } catch {
      /* posthog optional */
    }
  }
}

export function trackEvent(name, properties = {}) {
  if (typeof window !== 'undefined' && window.posthog) {
    window.posthog.capture(name, properties);
  }
}
