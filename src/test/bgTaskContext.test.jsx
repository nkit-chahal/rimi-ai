import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { BgTaskProvider, useBgTasks } from '../contexts/BgTaskContext';

const wrapper = ({ children }) => React.createElement(
  BgTaskProvider,
  { currentUserId: 77, token: 'test-token' },
  children,
);

describe('BgTaskProvider', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('tracks a task through completion and normalizes result URLs', async () => {
    const { result } = renderHook(() => useBgTasks(), { wrapper });

    act(() => {
      result.current.addBgTask(
        'seamless',
        'Make seamless',
        'input.png',
        async (reportProgress) => {
          reportProgress(45, 'Blending');
          return { urls: ['/results/a.png', '/results/b.png'] };
        },
      );
    });

    await waitFor(() => expect(result.current.bgTasks[0]?.status).toBe('completed'));
    expect(result.current.bgTasks[0]).toMatchObject({
      progress: 100,
      resultUrl: '/results/a.png',
      resultUrls: ['/results/a.png', '/results/b.png'],
    });
  });

  it('restores an untracked running task as an honest interrupted failure', () => {
    window.sessionStorage.setItem('rimi:bg-tasks:77', JSON.stringify([{
      id: 'interrupted-task',
      type: 'mappings',
      label: 'Generate mockups',
      filename: 'pattern.png',
      status: 'running',
      progress: 52,
      _startedAt: Date.now(),
      _ts: Date.now(),
    }]));

    const { result } = renderHook(() => useBgTasks(), { wrapper });
    expect(result.current.bgTasks[0]).toMatchObject({
      id: 'interrupted-task',
      status: 'failed',
      stage: 'Interrupted',
    });
    expect(result.current.bgTasks[0].error).toContain('page reload');
  });
});
