/**
 * CronScheduler — persistent cron job scheduler.
 *
 * Jobs are stored in SQLite (cron_jobs table), not config.json5.
 * Uses node-cron for scheduling.
 *
 * Each job has a `handler` string that maps to a registered handler function.
 * Built-in handler: 'polymarket-scan' → PolymarketScanner.runFullScan()
 */

import cron, { ScheduledTask } from 'node-cron';
import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  handler: string;
  config?: Record<string, any>;
  enabled: boolean;
  lastRunAt?: number;
  lastStatus?: string;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export type CronHandler = (job: CronJob) => Promise<void>;

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export class CronScheduler {
  private db: Database.Database;
  private handlers: Map<string, CronHandler> = new Map();
  private tasks: Map<string, ScheduledTask> = new Map();
  private running = false;
  private maxConcurrent: number;
  private activeRuns = 0;

  constructor(db: Database.Database, opts?: { maxConcurrent?: number }) {
    this.db = db;
    this.maxConcurrent = opts?.maxConcurrent ?? 2;
  }

  // -------------------------------------------------------------------------
  // Handler registration
  // -------------------------------------------------------------------------

  registerHandler(name: string, handler: CronHandler): void {
    this.handlers.set(name, handler);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start the scheduler: load jobs from DB, schedule enabled ones.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    const jobs = this.listJobs();
    let scheduled = 0;

    for (const job of jobs) {
      if (job.enabled) {
        this.scheduleJob(job);
        scheduled++;
      }
    }

    console.log(`[CronScheduler] Started: ${scheduled}/${jobs.length} jobs scheduled`);
  }

  /**
   * Stop all scheduled tasks.
   */
  stop(): void {
    this.running = false;
    for (const [id, task] of this.tasks) {
      task.stop();
    }
    this.tasks.clear();
    console.log('[CronScheduler] Stopped');
  }

  // -------------------------------------------------------------------------
  // Job CRUD (DB-backed)
  // -------------------------------------------------------------------------

  listJobs(): CronJob[] {
    const rows = this.db.prepare('SELECT * FROM cron_jobs ORDER BY created_at ASC').all() as any[];
    return rows.map(r => this.rowToJob(r));
  }

  getJob(id: string): CronJob | undefined {
    const row = this.db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id) as any;
    return row ? this.rowToJob(row) : undefined;
  }

  createJob(job: Omit<CronJob, 'createdAt' | 'updatedAt'>): CronJob {
    if (!cron.validate(job.schedule)) {
      throw new Error(`Invalid cron expression: ${job.schedule}`);
    }

    const now = Math.floor(Date.now() / 1000);
    this.db.prepare(`
      INSERT INTO cron_jobs (id, name, schedule, handler, config, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      job.id,
      job.name,
      job.schedule,
      job.handler,
      job.config ? JSON.stringify(job.config) : null,
      job.enabled ? 1 : 0,
      now,
      now,
    );

    const created = this.getJob(job.id)!;

    // Auto-schedule if running and enabled
    if (this.running && created.enabled) {
      this.scheduleJob(created);
    }

    console.log(`[CronScheduler] Job created: ${job.id} (${job.schedule}) handler=${job.handler}`);
    return created;
  }

  updateJob(id: string, updates: Partial<Pick<CronJob, 'name' | 'schedule' | 'enabled' | 'config'>>): CronJob | undefined {
    const existing = this.getJob(id);
    if (!existing) return undefined;

    if (updates.schedule && !cron.validate(updates.schedule)) {
      throw new Error(`Invalid cron expression: ${updates.schedule}`);
    }

    const now = Math.floor(Date.now() / 1000);
    this.db.prepare(`
      UPDATE cron_jobs SET
        name = COALESCE(?, name),
        schedule = COALESCE(?, schedule),
        enabled = COALESCE(?, enabled),
        config = COALESCE(?, config),
        updated_at = ?
      WHERE id = ?
    `).run(
      updates.name ?? null,
      updates.schedule ?? null,
      updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : null,
      updates.config ? JSON.stringify(updates.config) : null,
      now,
      id,
    );

    // Reschedule
    this.unscheduleJob(id);
    const updated = this.getJob(id)!;
    if (this.running && updated.enabled) {
      this.scheduleJob(updated);
    }

    return updated;
  }

  deleteJob(id: string): boolean {
    this.unscheduleJob(id);
    const result = this.db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Manually trigger a job (ignores schedule, runs immediately).
   */
  async triggerJob(id: string): Promise<void> {
    const job = this.getJob(id);
    if (!job) throw new Error(`Job not found: ${id}`);
    await this.executeJob(job);
  }

  // -------------------------------------------------------------------------
  // Internal scheduling
  // -------------------------------------------------------------------------

  private scheduleJob(job: CronJob): void {
    if (this.tasks.has(job.id)) return;

    const task = cron.schedule(job.schedule, () => {
      this.executeJob(job).catch(err => {
        console.error(`[CronScheduler] Job ${job.id} unhandled error: ${err.message}`);
      });
    });

    this.tasks.set(job.id, task);
  }

  private unscheduleJob(id: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.stop();
      this.tasks.delete(id);
    }
  }

  private async executeJob(job: CronJob): Promise<void> {
    // Concurrency guard
    if (this.activeRuns >= this.maxConcurrent) {
      console.warn(`[CronScheduler] Skipping ${job.id}: max concurrent runs (${this.maxConcurrent}) reached`);
      return;
    }

    const handler = this.handlers.get(job.handler);
    if (!handler) {
      console.error(`[CronScheduler] No handler registered for '${job.handler}'`);
      this.updateJobStatus(job.id, 'error', `No handler: ${job.handler}`);
      return;
    }

    this.activeRuns++;
    const start = Date.now();
    console.log(`[CronScheduler] Running job: ${job.id} (handler=${job.handler})`);

    try {
      await handler(job);
      this.updateJobStatus(job.id, 'success');
      console.log(`[CronScheduler] Job ${job.id} completed (${Date.now() - start}ms)`);
    } catch (err: any) {
      this.updateJobStatus(job.id, 'error', err.message);
      console.error(`[CronScheduler] Job ${job.id} failed: ${err.message}`);
    } finally {
      this.activeRuns--;
    }
  }

  private updateJobStatus(id: string, status: string, error?: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.prepare(`
      UPDATE cron_jobs SET last_run_at = ?, last_status = ?, last_error = ?, updated_at = ?
      WHERE id = ?
    `).run(now, status, error ?? null, now, id);
  }

  private rowToJob(row: any): CronJob {
    return {
      id: row.id,
      name: row.name,
      schedule: row.schedule,
      handler: row.handler,
      config: row.config ? JSON.parse(row.config) : undefined,
      enabled: !!row.enabled,
      lastRunAt: row.last_run_at ?? undefined,
      lastStatus: row.last_status ?? undefined,
      lastError: row.last_error ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
