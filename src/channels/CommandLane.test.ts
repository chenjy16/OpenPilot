/**
 * CommandLane unit tests
 */
import {
  enqueueCommandInLane,
  setCommandLaneConcurrency,
  getLaneStats,
  resetLanes,
} from './CommandLane';

beforeEach(() => {
  resetLanes();
});

describe('CommandLane', () => {
  it('executes a single task immediately', async () => {
    const result = await enqueueCommandInLane('main', async () => 42);
    expect(result).toBe(42);
  });

  it('respects concurrency limit', async () => {
    setCommandLaneConcurrency('test-lane', 2);

    let running = 0;
    let maxRunning = 0;

    const makeTask = (id: number) => enqueueCommandInLane('test-lane', async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise(r => setTimeout(r, 50));
      running--;
      return id;
    });

    const results = await Promise.all([
      makeTask(1), makeTask(2), makeTask(3), makeTask(4),
    ]);

    expect(results).toEqual([1, 2, 3, 4]);
    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it('uses default concurrency for known lanes', () => {
    enqueueCommandInLane('main', async () => {});
    const stats = getLaneStats();
    expect(stats.main.maxConcurrent).toBe(4);
  });

  it('cron lane defaults to concurrency 1', async () => {
    let running = 0;
    let maxRunning = 0;

    const makeTask = () => enqueueCommandInLane('cron', async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise(r => setTimeout(r, 20));
      running--;
    });

    await Promise.all([makeTask(), makeTask(), makeTask()]);
    expect(maxRunning).toBe(1);
  });

  it('getLaneStats returns correct counts', async () => {
    setCommandLaneConcurrency('slow', 1);

    let resolveFirst: () => void;
    const firstBlocking = new Promise<void>(r => { resolveFirst = r; });

    const task1 = enqueueCommandInLane('slow', () => firstBlocking);
    const task2Promise = enqueueCommandInLane('slow', async () => 'done');

    // Give a tick for task1 to start
    await new Promise(r => setTimeout(r, 10));

    const stats = getLaneStats();
    expect(stats.slow.running).toBe(1);
    expect(stats.slow.queued).toBe(1);

    resolveFirst!();
    await task1;
    const result = await task2Promise;
    expect(result).toBe('done');
  });

  it('propagates task errors', async () => {
    await expect(
      enqueueCommandInLane('main', async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
  });

  it('setCommandLaneConcurrency updates limit', () => {
    setCommandLaneConcurrency('custom', 10);
    const stats = getLaneStats();
    expect(stats.custom.maxConcurrent).toBe(10);
  });

  it('enforces minimum concurrency of 1', () => {
    setCommandLaneConcurrency('min-test', 0);
    const stats = getLaneStats();
    expect(stats['min-test'].maxConcurrent).toBe(1);
  });

  it('calls onWait callback when task is queued', async () => {
    setCommandLaneConcurrency('wait-test', 1);
    const onWait = jest.fn();

    let resolveFirst: () => void;
    const blocking = new Promise<void>(r => { resolveFirst = r; });

    const task1 = enqueueCommandInLane('wait-test', () => blocking);
    const task2 = enqueueCommandInLane('wait-test', async () => 'ok', { onWait });

    await new Promise(r => setTimeout(r, 50));
    resolveFirst!();
    await task1;
    await task2;

    expect(onWait).toHaveBeenCalled();
    expect(onWait.mock.calls[0][0]).toBeGreaterThan(0); // waitMs > 0
  });
});
