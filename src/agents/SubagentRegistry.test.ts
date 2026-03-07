/**
 * SubagentRegistry unit tests
 */
import {
  registerSubagentRun,
  completeSubagentRun,
  waitForSubagentCompletion,
  countActiveRunsForSession,
  listDescendantRunsForRequester,
  getSubagentRun,
  archiveStaleRuns,
  getSubagentStats,
  resetSubagentRegistry,
  setSubagentLimits,
  getSubagentLimits,
} from './SubagentRegistry';

beforeEach(() => {
  resetSubagentRegistry();
});

describe('SubagentRegistry', () => {
  it('registers and retrieves a sub-agent run', () => {
    const record = registerSubagentRun({
      runId: 'run-1',
      requesterSessionKey: 'agent:main:main',
      childSessionKey: 'agent:main:subagent:run-1',
      agentId: 'assistant',
    });
    expect(record.status).toBe('running');
    expect(record.agentId).toBe('assistant');

    const retrieved = getSubagentRun('run-1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.runId).toBe('run-1');
  });

  it('completes a run successfully', () => {
    registerSubagentRun({
      runId: 'run-2',
      requesterSessionKey: 'sess-a',
      childSessionKey: 'sess-a-sub',
      agentId: 'coder',
    });
    completeSubagentRun('run-2');
    const record = getSubagentRun('run-2');
    expect(record!.status).toBe('completed');
    expect(record!.completedAt).toBeDefined();
  });

  it('marks a run as failed with error', () => {
    registerSubagentRun({
      runId: 'run-3',
      requesterSessionKey: 'sess-a',
      childSessionKey: 'sess-a-sub',
      agentId: 'coder',
    });
    completeSubagentRun('run-3', 'timeout');
    const record = getSubagentRun('run-3');
    expect(record!.status).toBe('failed');
    expect(record!.error).toBe('timeout');
  });

  it('enforces maxSpawnDepth', () => {
    setSubagentLimits({ maxSpawnDepth: 1 });
    // depth=0 is OK
    registerSubagentRun({
      runId: 'run-d0',
      requesterSessionKey: 'sess',
      childSessionKey: 'sess-sub',
      agentId: 'a',
      depth: 0,
    });
    // depth=1 should fail
    expect(() => registerSubagentRun({
      runId: 'run-d1',
      requesterSessionKey: 'sess-sub',
      childSessionKey: 'sess-sub-sub',
      agentId: 'b',
      depth: 1,
    })).toThrow(/spawn depth limit/);
  });

  it('enforces maxChildrenPerAgent', () => {
    setSubagentLimits({ maxChildrenPerAgent: 2 });
    registerSubagentRun({ runId: 'c1', requesterSessionKey: 'parent', childSessionKey: 's1', agentId: 'a' });
    registerSubagentRun({ runId: 'c2', requesterSessionKey: 'parent', childSessionKey: 's2', agentId: 'b' });
    expect(() => registerSubagentRun({
      runId: 'c3', requesterSessionKey: 'parent', childSessionKey: 's3', agentId: 'c',
    })).toThrow(/children limit/);
  });

  it('completed runs do not count toward children limit', () => {
    setSubagentLimits({ maxChildrenPerAgent: 1 });
    registerSubagentRun({ runId: 'x1', requesterSessionKey: 'p', childSessionKey: 's1', agentId: 'a' });
    completeSubagentRun('x1');
    // Should succeed since x1 is completed
    const r = registerSubagentRun({ runId: 'x2', requesterSessionKey: 'p', childSessionKey: 's2', agentId: 'b' });
    expect(r.status).toBe('running');
  });

  it('countActiveRunsForSession counts only running', () => {
    registerSubagentRun({ runId: 'r1', requesterSessionKey: 'sess', childSessionKey: 's1', agentId: 'a' });
    registerSubagentRun({ runId: 'r2', requesterSessionKey: 'sess', childSessionKey: 's2', agentId: 'b' });
    completeSubagentRun('r1');
    expect(countActiveRunsForSession('sess')).toBe(1);
  });

  it('listDescendantRunsForRequester returns all runs', () => {
    registerSubagentRun({ runId: 'r1', requesterSessionKey: 'root', childSessionKey: 's1', agentId: 'a' });
    registerSubagentRun({ runId: 'r2', requesterSessionKey: 'root', childSessionKey: 's2', agentId: 'b' });
    registerSubagentRun({ runId: 'r3', requesterSessionKey: 'other', childSessionKey: 's3', agentId: 'c' });
    const descendants = listDescendantRunsForRequester('root');
    expect(descendants).toHaveLength(2);
  });

  it('waitForSubagentCompletion resolves when run completes', async () => {
    registerSubagentRun({ runId: 'w1', requesterSessionKey: 'sess', childSessionKey: 's1', agentId: 'a' });
    const waitPromise = waitForSubagentCompletion('w1', 5000);
    // Complete after a short delay
    setTimeout(() => completeSubagentRun('w1'), 50);
    await waitPromise;
    expect(getSubagentRun('w1')!.status).toBe('completed');
  });

  it('waitForSubagentCompletion resolves immediately if already completed', async () => {
    registerSubagentRun({ runId: 'w2', requesterSessionKey: 'sess', childSessionKey: 's1', agentId: 'a' });
    completeSubagentRun('w2');
    await waitForSubagentCompletion('w2', 100);
    // Should not hang
    expect(getSubagentRun('w2')!.status).toBe('completed');
  });

  it('waitForSubagentCompletion times out gracefully', async () => {
    registerSubagentRun({ runId: 'w3', requesterSessionKey: 'sess', childSessionKey: 's1', agentId: 'a' });
    await waitForSubagentCompletion('w3', 50);
    // Should resolve after timeout, run still running
    expect(getSubagentRun('w3')!.status).toBe('running');
  });

  it('archiveStaleRuns removes old completed runs', () => {
    registerSubagentRun({ runId: 'old', requesterSessionKey: 'sess', childSessionKey: 's1', agentId: 'a' });
    completeSubagentRun('old');
    // Set archive window to 0 minutes — but completedAt is "now", so we need a tiny buffer
    // Use -1 minute to ensure the cutoff is in the future
    setSubagentLimits({ archiveAfterMinutes: -1 });
    const archived = archiveStaleRuns();
    expect(archived).toBe(1);
    expect(getSubagentRun('old')).toBeUndefined();
  });

  it('getSubagentStats returns correct counts', () => {
    registerSubagentRun({ runId: 's1', requesterSessionKey: 'sess', childSessionKey: 'c1', agentId: 'a' });
    registerSubagentRun({ runId: 's2', requesterSessionKey: 'sess', childSessionKey: 'c2', agentId: 'b' });
    completeSubagentRun('s2');
    registerSubagentRun({ runId: 's3', requesterSessionKey: 'sess', childSessionKey: 'c3', agentId: 'c' });
    completeSubagentRun('s3', 'error');

    const stats = getSubagentStats();
    expect(stats.total).toBe(3);
    expect(stats.running).toBe(1);
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(1);
  });

  it('setSubagentLimits and getSubagentLimits work', () => {
    setSubagentLimits({ maxSpawnDepth: 3, maxChildrenPerAgent: 10 });
    const l = getSubagentLimits();
    expect(l.maxSpawnDepth).toBe(3);
    expect(l.maxChildrenPerAgent).toBe(10);
    expect(l.archiveAfterMinutes).toBe(60); // default unchanged
  });
});
