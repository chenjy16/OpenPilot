/**
 * SubagentRegistry — manages sub-agent lifecycle, delegation, and communication.
 *
 * Design doc: "多频道多智能体协同工作.md" §组件6
 *
 * Tracks active sub-agent runs, enforces spawn depth/count limits,
 * and provides wait-for-completion semantics.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubagentRunRecord {
  runId: string;
  requesterSessionKey: string;
  childSessionKey: string;
  agentId: string;
  model?: string;
  status: 'running' | 'completed' | 'failed' | 'archived';
  startedAt: number;
  completedAt?: number;
  error?: string;
  depth: number;
  parentRunId?: string;
}

export interface SubagentLimits {
  maxSpawnDepth: number;
  maxChildrenPerAgent: number;
  archiveAfterMinutes: number;
  announceTimeoutMs: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_LIMITS: SubagentLimits = {
  maxSpawnDepth: 1,
  maxChildrenPerAgent: 5,
  archiveAfterMinutes: 60,
  announceTimeoutMs: 60_000,
};

// ---------------------------------------------------------------------------
// Registry (singleton)
// ---------------------------------------------------------------------------

const runs: Map<string, SubagentRunRecord> = new Map();
const completionWaiters: Map<string, Array<{ resolve: () => void; timer: ReturnType<typeof setTimeout> }>> = new Map();
let limits: SubagentLimits = { ...DEFAULT_LIMITS };

/**
 * Configure sub-agent limits (typically from appConfig).
 */
export function setSubagentLimits(newLimits: Partial<SubagentLimits>): void {
  limits = { ...limits, ...newLimits };
}

/**
 * Get current limits.
 */
export function getSubagentLimits(): SubagentLimits {
  return { ...limits };
}

/**
 * Register a new sub-agent run.
 * Throws if spawn depth or children count limits are exceeded.
 */
export function registerSubagentRun(params: {
  runId: string;
  requesterSessionKey: string;
  childSessionKey: string;
  agentId: string;
  model?: string;
  depth?: number;
  parentRunId?: string;
}): SubagentRunRecord {
  const depth = params.depth ?? 0;

  // Enforce spawn depth limit
  if (depth >= limits.maxSpawnDepth) {
    throw new Error(
      `Sub-agent spawn depth limit exceeded: depth=${depth}, max=${limits.maxSpawnDepth}`,
    );
  }

  // Enforce children-per-requester limit
  const activeChildren = countActiveRunsForSession(params.requesterSessionKey);
  if (activeChildren >= limits.maxChildrenPerAgent) {
    throw new Error(
      `Sub-agent children limit exceeded: active=${activeChildren}, max=${limits.maxChildrenPerAgent}`,
    );
  }

  const record: SubagentRunRecord = {
    runId: params.runId,
    requesterSessionKey: params.requesterSessionKey,
    childSessionKey: params.childSessionKey,
    agentId: params.agentId,
    model: params.model,
    status: 'running',
    startedAt: Date.now(),
    depth,
    parentRunId: params.parentRunId,
  };

  runs.set(params.runId, record);
  return record;
}

/**
 * Mark a sub-agent run as completed.
 */
export function completeSubagentRun(runId: string, error?: string): void {
  const record = runs.get(runId);
  if (!record) return;

  record.status = error ? 'failed' : 'completed';
  record.completedAt = Date.now();
  record.error = error;

  // Resolve any waiters
  const waiters = completionWaiters.get(runId);
  if (waiters) {
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.resolve();
    }
    completionWaiters.delete(runId);
  }
}

/**
 * Wait for a sub-agent run to complete.
 * Returns immediately if already completed.
 */
export async function waitForSubagentCompletion(
  runId: string,
  waitTimeoutMs?: number,
): Promise<void> {
  const record = runs.get(runId);
  if (!record || record.status !== 'running') return;

  const timeout = waitTimeoutMs ?? limits.announceTimeoutMs;

  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      // Timeout — resolve anyway, caller can check status
      const waiters = completionWaiters.get(runId);
      if (waiters) {
        const idx = waiters.findIndex(w => w.resolve === resolve);
        if (idx >= 0) waiters.splice(idx, 1);
        if (waiters.length === 0) completionWaiters.delete(runId);
      }
      resolve();
    }, timeout);

    const existing = completionWaiters.get(runId) ?? [];
    existing.push({ resolve, timer });
    completionWaiters.set(runId, existing);
  });
}

/**
 * Count active (running) sub-agent runs for a given requester session.
 */
export function countActiveRunsForSession(requesterSessionKey: string): number {
  let count = 0;
  for (const record of runs.values()) {
    if (record.requesterSessionKey === requesterSessionKey && record.status === 'running') {
      count++;
    }
  }
  return count;
}

/**
 * List all descendant runs for a requester (including nested).
 */
export function listDescendantRunsForRequester(rootSessionKey: string): SubagentRunRecord[] {
  const result: SubagentRunRecord[] = [];
  for (const record of runs.values()) {
    if (record.requesterSessionKey === rootSessionKey) {
      result.push({ ...record });
    }
  }
  return result;
}

/**
 * Get a specific run record.
 */
export function getSubagentRun(runId: string): SubagentRunRecord | undefined {
  const record = runs.get(runId);
  return record ? { ...record } : undefined;
}

/**
 * Archive old completed/failed runs (garbage collection).
 */
export function archiveStaleRuns(): number {
  const cutoff = Date.now() - limits.archiveAfterMinutes * 60_000;
  let archived = 0;
  for (const [runId, record] of runs) {
    if (record.status !== 'running' && (record.completedAt ?? record.startedAt) < cutoff) {
      runs.delete(runId);
      archived++;
    }
  }
  return archived;
}

/**
 * Get registry stats for monitoring.
 */
export function getSubagentStats(): {
  total: number;
  running: number;
  completed: number;
  failed: number;
} {
  let running = 0, completed = 0, failed = 0;
  for (const record of runs.values()) {
    switch (record.status) {
      case 'running': running++; break;
      case 'completed': completed++; break;
      case 'failed': failed++; break;
    }
  }
  return { total: runs.size, running, completed, failed };
}

/**
 * Reset registry (for testing).
 */
export function resetSubagentRegistry(): void {
  // Clear all waiters
  for (const waiters of completionWaiters.values()) {
    for (const w of waiters) clearTimeout(w.timer);
  }
  completionWaiters.clear();
  runs.clear();
  limits = { ...DEFAULT_LIMITS };
}
