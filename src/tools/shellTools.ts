/**
 * Shell Tools
 * Provides shell command execution through the Sandbox layer.
 *
 * OpenPilot spec: dangerous tools (shell.execute) must run through sandbox
 * and require human approval via PolicyEngine.requireApproval.
 */

import { Tool } from '../types';
import { ToolExecutor } from './ToolExecutor';
import { ExecutionSandbox } from '../runtime/sandbox';

/**
 * Create a shell execution tool that delegates to the provided sandbox.
 * The sandbox determines whether commands run locally or in Docker isolation.
 */
export function createShellTool(sandbox: ExecutionSandbox): Tool {
  return {
    name: 'shellExecute',
    description: 'Execute a shell command and return stdout, stderr, and exit code. Dangerous operations require user approval.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the command (optional)',
        },
        timeoutMs: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000, max: 30000)',
        },
      },
      required: ['command'],
    },
    execute: async (params: Record<string, unknown>) => {
      const command = params.command as string;
      const cwd = params.cwd as string | undefined;
      const timeoutMs = Math.min(
        (params.timeoutMs as number | undefined) ?? 30_000,
        30_000,
      );

      const result = await sandbox.exec(command, { cwd, timeoutMs });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    },
  };
}

/**
 * Register shell tools with the given ToolExecutor.
 */
export function registerShellTools(executor: ToolExecutor, sandbox: ExecutionSandbox): void {
  executor.register(createShellTool(sandbox));
}
