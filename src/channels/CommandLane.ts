/**
 * CommandLane — concurrency control for multi-agent execution
 *
 * Each lane has a configurable max concurrency. Tasks are queued
 * and executed in FIFO order within the lane's concurrency limit.
 *
 * Design doc: "多频道多智能体协同工作.md" §组件5
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LaneName = 'main' | 'cron' | 'subagent' | 'nested' | string;

interface QueuedTask<T = any> {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
  onWait?: (waitMs: number, queuedAhead: number) => void;
  warnAfterMs?: number;
  warnTimer?: ReturnType<typeof setTimeout>;
}

interface LaneState {
  maxConcurrent: number;
  running: number;
  queue: QueuedTask[];
}

// ---------------------------------------------------------------------------
// Default concurrency limits (design doc §默认并发限制)
// ---------------------------------------------------------------------------

const DEFAULT_CONCURRENCY: Record<string, number> = {
  main: 4,
  subagent: 8,
  cron: 1,
  nested: 2,
};

// ---------------------------------------------------------------------------
// Lane Manager (singleton)
// ---------------------------------------------------------------------------

const lanes: Map<string, LaneState> = new Map();

function getLane(name: LaneName): LaneState {
  let lane = lanes.get(name);
  if (!lane) {
    lane = {
      maxConcurrent: DEFAULT_CONCURRENCY[name] ?? 4,
      running: 0,
      queue: [],
    };
    lanes.set(name, lane);
  }
  return lane;
}

/**
 * Set the max concurrency for a lane.
 */
export function setCommandLaneConcurrency(lane: LaneName, maxConcurrent: number): void {
  const state = getLane(lane);
  state.maxConcurrent = Math.max(1, maxConcurrent);
  // Drain queue if we now have capacity
  drainQueue(lane);
}

/**
 * Enqueue a task into a specific lane.
 * Returns a promise that resolves when the task completes.
 */
export function enqueueCommandInLane<T>(
  lane: LaneName,
  task: () => Promise<T>,
  opts?: {
    warnAfterMs?: number;
    onWait?: (waitMs: number, queuedAhead: number) => void;
  },
): Promise<T> {
  const state = getLane(lane);

  return new Promise<T>((resolve, reject) => {
    const queued: QueuedTask<T> = {
      task,
      resolve,
      reject,
      enqueuedAt: Date.now(),
      onWait: opts?.onWait,
      warnAfterMs: opts?.warnAfterMs,
    };

    state.queue.push(queued);
    drainQueue(lane);
  });
}

/**
 * Get lane stats for monitoring.
 */
export function getLaneStats(): Record<string, { running: number; queued: number; maxConcurrent: number }> {
  const stats: Record<string, { running: number; queued: number; maxConcurrent: number }> = {};
  for (const [name, state] of lanes) {
    stats[name] = {
      running: state.running,
      queued: state.queue.length,
      maxConcurrent: state.maxConcurrent,
    };
  }
  return stats;
}

/**
 * Reset all lanes (for testing).
 */
export function resetLanes(): void {
  lanes.clear();
}

// ---------------------------------------------------------------------------
// Internal: drain queue
// ---------------------------------------------------------------------------

function drainQueue(laneName: LaneName): void {
  const state = getLane(laneName);

  while (state.running < state.maxConcurrent && state.queue.length > 0) {
    const queued = state.queue.shift()!;
    state.running++;

    // Clear any warn timer since we're now executing
    if (queued.warnTimer) {
      clearTimeout(queued.warnTimer);
      queued.warnTimer = undefined;
    }

    // Notify waiter if they've been waiting
    if (queued.onWait) {
      const waitMs = Date.now() - queued.enqueuedAt;
      if (waitMs > 0) {
        queued.onWait(waitMs, state.queue.length);
      }
    }

    // Execute
    queued.task()
      .then(result => {
        queued.resolve(result);
      })
      .catch(err => {
        queued.reject(err);
      })
      .finally(() => {
        state.running--;
        drainQueue(laneName);
      });
  }

  // Set warn timers for tasks still in queue
  for (const queued of state.queue) {
    if (queued.warnAfterMs && !queued.warnTimer) {
      const remaining = queued.warnAfterMs - (Date.now() - queued.enqueuedAt);
      if (remaining > 0) {
        queued.warnTimer = setTimeout(() => {
          console.warn(
            `[CommandLane] Task in '${laneName}' has been queued for ${queued.warnAfterMs}ms (${state.queue.length} in queue)`,
          );
        }, remaining);
        // Don't prevent process exit
        if (queued.warnTimer && typeof queued.warnTimer === 'object' && 'unref' in queued.warnTimer) {
          (queued.warnTimer as any).unref();
        }
      }
    }
  }
}
