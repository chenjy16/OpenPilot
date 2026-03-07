/**
 * Sub-Agent Tools
 *
 * Allows the main Agent to spawn child Agent sessions for delegated tasks.
 * OpenPilot equivalent: sessions_spawn + subagents tools.
 *
 * Design:
 *   - Child agents share the same model and tool set (with restricted policy)
 *   - Depth limit prevents infinite recursion (max 3 levels)
 *   - Child sessions are persisted like normal sessions
 *   - Results are returned as structured text to the parent
 */

import { Tool } from '../types';
import { ToolExecutor } from './ToolExecutor';

/** Maximum nesting depth for sub-agents */
const MAX_DEPTH = 3;

/**
 * Factory context needed to spawn sub-agents.
 * Injected at registration time from AIRuntime.
 */
export interface SubAgentContext {
  /** Execute a sub-agent request and return the final text */
  executeSubAgent: (opts: {
    parentSessionId: string;
    task: string;
    model: string;
    depth: number;
  }) => Promise<string>;
}

/**
 * Create the sub-agent spawn tool.
 */
export function createSubAgentTool(ctx: SubAgentContext): Tool {
  return {
    name: 'spawnSubAgent',
    description:
      'Spawn a child Agent to handle a delegated sub-task. The child runs independently ' +
      'with its own session and returns the result. Use for complex tasks that benefit from ' +
      'focused context (e.g. research, code review, data analysis). Max depth: 3 levels.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'The task description / prompt for the child agent',
        },
        model: {
          type: 'string',
          description: 'Model to use for the child agent (optional, defaults to parent model)',
        },
      },
      required: ['task'],
    },
    execute: async (params: Record<string, unknown>) => {
      const task = params.task as string;
      const model = params.model as string | undefined;

      if (!task || task.trim() === '') {
        throw new Error('Task description must be non-empty');
      }

      // Extract depth from session metadata (encoded in sessionId convention)
      // Parent passes depth via the tool context
      const depth = (params as any).__depth ?? 0;

      if (depth >= MAX_DEPTH) {
        throw new Error(
          `Sub-agent depth limit reached (max ${MAX_DEPTH}). ` +
          'Cannot spawn further child agents. Complete the task directly.',
        );
      }

      const result = await ctx.executeSubAgent({
        parentSessionId: (params as any).__sessionId ?? 'unknown',
        task,
        model: model ?? (params as any).__model ?? 'gpt-3.5-turbo',
        depth: depth + 1,
      });

      return {
        status: 'completed',
        result: result.length > 4000 ? result.slice(0, 4000) + '\n[...truncated]' : result,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register sub-agent tools with the given ToolExecutor.
 *
 * Note: The SubAgentContext.executeSubAgent callback must be wired to
 * AIRuntime.execute() at bootstrap time (in src/index.ts).
 */
export function registerSubAgentTools(executor: ToolExecutor, ctx: SubAgentContext): void {
  executor.register(createSubAgentTool(ctx));
}
