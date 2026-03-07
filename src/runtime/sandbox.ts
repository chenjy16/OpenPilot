/**
 * Execution Sandbox Abstraction
 *
 * OpenPilot Constraint 1: Session Sandboxing
 * Non-main sessions (public channels, cron tasks) must execute shell/script
 * tools inside an isolated Docker container. This module provides the
 * abstraction layer so ToolExecutor can delegate execution transparently.
 *
 * Current implementation ships with LocalSandbox (passthrough).
 * DockerSandbox is a placeholder for future container-level isolation
 * (Issue #27259 / RFC #5536).
 */

export interface SandboxExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SandboxOptions {
  /** Working directory inside the sandbox */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Hard timeout in milliseconds */
  timeoutMs?: number;
  /** Optional AbortSignal for external cancellation */
  signal?: AbortSignal;
}

/**
 * ExecutionSandbox — the contract every sandbox implementation must satisfy.
 */
export interface ExecutionSandbox {
  /** Human-readable sandbox type identifier */
  readonly type: string;

  /**
   * Execute a shell command inside the sandbox.
   * @param command - The command string to run
   * @param options - Execution options
   * @returns Execution result with stdout, stderr, exitCode
   */
  exec(command: string, options?: SandboxOptions): Promise<SandboxExecResult>;

  /**
   * Tear down sandbox resources (e.g. stop Docker container).
   * No-op for LocalSandbox.
   */
  destroy(): Promise<void>;
}

// ---------------------------------------------------------------------------
// LocalSandbox — executes commands directly on the host (current behaviour)
// ---------------------------------------------------------------------------

import { exec as cpExec } from 'child_process';

export class LocalSandbox implements ExecutionSandbox {
  readonly type = 'local';

  async exec(command: string, options?: SandboxOptions): Promise<SandboxExecResult> {
    const timeoutMs = options?.timeoutMs ?? 30_000;

    return new Promise<SandboxExecResult>((resolve, reject) => {
      let settled = false;

      const child = cpExec(command, {
        cwd: options?.cwd,
        env: options?.env ? { ...process.env, ...options.env } : undefined,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024, // 1 MB
      }, (error, stdout, stderr) => {
        if (settled) return; // Already rejected by abort — discard
        settled = true;
        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode: error?.code != null ? (typeof error.code === 'number' ? error.code : 1) : 0,
        });
      });

      // AbortSignal support
      if (options?.signal) {
        const onAbort = () => {
          if (settled) return;
          settled = true;
          child.kill('SIGTERM');
          reject(new Error('Sandbox execution aborted'));
        };
        if (options.signal.aborted) {
          settled = true;
          child.kill('SIGTERM');
          reject(new Error('Sandbox execution aborted'));
          return;
        }
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  async destroy(): Promise<void> {
    // No-op for local execution
  }
}

// ---------------------------------------------------------------------------
// DockerSandbox — placeholder for future container-level isolation
// ---------------------------------------------------------------------------

export class DockerSandbox implements ExecutionSandbox {
  readonly type = 'docker';
  private containerId: string | null = null;
  private image: string;

  constructor(image: string = 'openpilot/sandbox:latest') {
    this.image = image;
  }

  /**
   * Start the sandbox container (lazy — created on first exec).
   */
  private async ensureContainer(): Promise<string> {
    if (this.containerId) return this.containerId;

    const { exec: cpExecFn } = require('child_process');
    const id = await new Promise<string>((resolve, reject) => {
      cpExecFn(
        `docker create --rm --network=none --memory=512m --cpus=1 -i ${this.image} sleep infinity`,
        { timeout: 30_000 },
        (err: any, stdout: string) => {
          if (err) return reject(new Error(`Failed to create Docker container: ${err.message}`));
          resolve(stdout.trim());
        },
      );
    });

    // Start the container
    await new Promise<void>((resolve, reject) => {
      cpExecFn(`docker start ${id}`, { timeout: 10_000 }, (err: any) => {
        if (err) return reject(new Error(`Failed to start Docker container: ${err.message}`));
        resolve();
      });
    });

    this.containerId = id;
    console.log(`[DockerSandbox] Container started: ${id.slice(0, 12)}`);
    return id;
  }

  async exec(command: string, options?: SandboxOptions): Promise<SandboxExecResult> {
    const containerId = await this.ensureContainer();
    const timeoutMs = options?.timeoutMs ?? 30_000;

    return new Promise<SandboxExecResult>((resolve, reject) => {
      const cwdFlag = options?.cwd ? `-w ${options.cwd}` : '';
      const envFlags = options?.env
        ? Object.entries(options.env).map(([k, v]) => `-e ${k}=${v}`).join(' ')
        : '';

      const child = cpExec(
        `docker exec ${cwdFlag} ${envFlags} ${containerId} sh -c ${JSON.stringify(command)}`,
        { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          resolve({
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            exitCode: error?.code != null ? (typeof error.code === 'number' ? error.code : 1) : 0,
          });
        },
      );

      if (options?.signal) {
        const onAbort = () => {
          child.kill('SIGTERM');
          reject(new Error('Docker sandbox execution aborted'));
        };
        if (options.signal.aborted) {
          child.kill('SIGTERM');
          reject(new Error('Docker sandbox execution aborted'));
          return;
        }
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  async destroy(): Promise<void> {
    if (this.containerId) {
      try {
        const { exec: cpExecFn } = require('child_process');
        await new Promise<void>((resolve) => {
          cpExecFn(`docker rm -f ${this.containerId}`, { timeout: 10_000 }, () => resolve());
        });
        console.log(`[DockerSandbox] Container removed: ${this.containerId.slice(0, 12)}`);
      } catch { /* ignore */ }
      this.containerId = null;
    }
  }
}

/**
 * Factory: create the appropriate sandbox based on session context.
 * Main sessions → LocalSandbox (full host access).
 * Non-main sessions → DockerSandbox (isolated, future).
 */
export function createSandbox(isMainSession: boolean = true, dockerImage?: string): ExecutionSandbox {
  if (isMainSession) {
    return new LocalSandbox();
  }
  // Non-main sessions use Docker isolation (requires Docker daemon)
  return new DockerSandbox(dockerImage);
}
