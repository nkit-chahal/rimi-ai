import * as Sentry from '@sentry/react';

export function initObservability() {
  const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      integrations: [Sentry.browserTracingIntegration()],
      tracesSampleRate: 0.1,
    });
  }

  const posthogKey = import.meta.env.VITE_POSTHOG_KEY;
  if (posthogKey && typeof window !== 'undefined') {
    import('posthog-js').then(({ default: posthog }) => {
      posthog.init(posthogKey, {
        api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com',
        capture_pageview: true,
      });
      window.posthog = posthog;
    }).catch(() => {});
  }
}

export function trackEvent(name, properties = {}) {
  if (typeof window !== 'undefined' && window.posthog) {
    window.posthog.capture(name, properties);
  }
}
