import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A job enqueued with no RQ worker to drain it stays 'queued' forever. waitForJob used to poll
 * without a ceiling, so the UI spun indefinitely with no error. These pin the ceilings.
 */
describe('waitForJob timeouts', () => {
  let waitForJob;
  let jobStatus;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    jobStatus = { status: 'queued', progressPct: 0 };
    vi.doMock('../components/studio/shared/apiClient.js', () => ({}));
    ({ waitForJob } = await import('../components/studio/shared/helpers.js'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const stubFetch = () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ job: jobStatus }),
    })));
  };

  it('gives up when a job never leaves the queue', async () => {
    stubFetch();
    const promise = waitForJob(1, 'tok').then(
      () => 'resolved',
      (err) => err.message,
    );
    await vi.advanceTimersByTimeAsync(95_000);
    await expect(promise).resolves.toMatch(/never started/i);
  });

  it('keeps waiting while the job is actually running', async () => {
    stubFetch();
    const settled = vi.fn();
    const promise = waitForJob(2, 'tok').then(settled, settled);
    await vi.advanceTimersByTimeAsync(5_000);
    jobStatus = { status: 'running', progressPct: 40 };
    await vi.advanceTimersByTimeAsync(120_000);
    expect(settled).not.toHaveBeenCalled();

    jobStatus = { status: 'completed', result: { url: '/results/x.png' } };
    await vi.advanceTimersByTimeAsync(1_000);
    await promise;
    expect(settled).toHaveBeenCalledWith({ url: '/results/x.png' });
  });
});
