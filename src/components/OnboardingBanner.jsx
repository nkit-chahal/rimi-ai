import { useEffect, useState } from 'react';
import { apiFetch } from './studio/shared/helpers';

export default function OnboardingBanner({ token, onProjectCreated, ready = true }) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token || !ready) return;
    apiFetch('/api/onboarding/status', {}, token)
      .then((data) => setVisible(Boolean(data.needsOnboarding)))
      .catch(() => setVisible(false));
  }, [token, ready]);

  if (!visible) return null;

  const createSample = async () => {
    setBusy(true);
    try {
      const data = await apiFetch('/api/onboarding/sample-project', { method: 'POST' }, token);
      setVisible(false);
      onProjectCreated?.(data.projectId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboarding-banner" role="region" aria-label="Getting started">
      <div>
        <strong>Welcome to RIMI AI</strong>
        <p>Create a sample project to explore pattern extraction, seamless tiles, and exports.</p>
      </div>
      <button type="button" className="btn-primary" onClick={createSample} disabled={busy}>
        {busy ? 'Creating…' : 'Start sample project'}
      </button>
    </div>
  );
}
