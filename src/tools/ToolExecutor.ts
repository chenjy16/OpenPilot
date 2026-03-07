/**
 * Tool Executor
 * Executes tool calls from AI models
 *
 * Aligned with OpenPilot Tool Pipeline architecture:
 * - before_tool_call / after_tool_call lifecycle hooks
 * - AbortSignal support for hard timeout / user cancellation
 * - Per-loop-iteration tool call cap (max_tool_calls guardrail)
 */

import { Tool, ToolCall, ToolResult, ToolParameters, ValidationError } from '../types';

// ---------------------------------------------------------------------------
// Tool lifecycle hook types (OpenPilot Policy Engine alignment)
// ---------------------------------------------------------------------------

export interface ToolCallContext {
  toolName: string;
  arguments: Record<string, any>;
  sessionId?: string;
}

/**
 * Hook invoked before a tool executes.
 * Return `false` to block execution (e.g. Human-in-the-loop denial).
 * Return a modified `ToolCallContext` to rewrite arguments.
 */
export type BeforeToolCallHook = (
  ctx: ToolCallContext,
) => Promise<boolean | ToolCallContext>;

/**
 * Hook invoked after a tool executes, receiving the result.
 * Can be used for audit logging, telemetry, etc.
 */
export type AfterToolCallHook = (
  ctx: ToolCallContext,
  result: ToolResult,
) => Promise<void>;

/** Default hard cap per execute() batch — prevents runaway ReAct loops */
const DEFAULT_MAX_TOOL_CALLS_PER_BATCH = 15;

/**
 * ToolExecutor manages tool registration and execution
 * 
 * Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5
 */
export class ToolExecutor {
  private tools: Map<string, Tool>;
  private beforeHooks: BeforeToolCallHook[] = [];
  private afterHooks: AfterToolCallHook[] = [];
  private maxToolCallsPerBatch: number = DEFAULT_MAX_TOOL_CALLS_PER_BATCH;

  constructor() {
    this.tools = new Map<string, Tool>();
  }

  // -----------------------------------------------------------------------
  // Hook registration (OpenPilot lifecycle hooks)
  // -----------------------------------------------------------------------

  /**
   * Register a before_tool_call hook.
   * Hooks run in registration order. If any hook returns false the call is blocked.
   */
  onBeforeToolCall(hook: BeforeToolCallHook): void {
    this.beforeHooks.push(hook);
  }

  /**
   * Register an after_tool_call hook.
   */
  onAfterToolCall(hook: AfterToolCallHook): void {
    this.afterHooks.push(hook);
  }

  /**
   * Override the per-batch tool call cap (default 15).
   */
  setMaxToolCallsPerBatch(max: number): void {
    this.maxToolCallsPerBatch = max;
  }

  /**
   * Register a tool with the executor
   * 
   * @param tool - The tool to register
   * @throws {ValidationError} if tool name is not unique
   * 
   * Validates: Requirements 12.1, 12.2, 12.3
   */
  register(tool: Tool): void {
    // Validate tool definition
    if (!tool.name || typeof tool.name !== 'string' || tool.name.trim() === '') {
      throw new ValidationError('Tool name must be a non-empty string');
    }

    if (!tool.description || typeof tool.description !== 'string') {
      throw new ValidationError('Tool description must be a non-empty string');
    }

    if (!tool.parameters || typeof tool.parameters !== 'object') {
      throw new ValidationError('Tool parameters must be defined');
    }

    if (typeof tool.execute !== 'function') {
      throw new ValidationError('Tool execute must be a function');
    }

    // Validate tool name uniqueness
    if (this.tools.has(tool.name)) {
      throw new ValidationError(`Tool '${tool.name}' is already registered`);
    }

    this.tools.set(tool.name, tool);
  }

  /**
   * Look up a tool by name
   * 
   * @param name - The name of the tool to look up
   * @returns The tool if found, undefined otherwise
   * 
   * Validates: Requirements 12.4
   */
  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool is registered
   * 
   * @param name - The name of the tool to check
   * @returns true if the tool is registered, false otherwise
   * 
   * Validates: Requirements 12.4
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all registered tool names
   * 
   * @returns Array of registered tool names
   */
  getRegisteredToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Execute tool calls in parallel with timeout, lifecycle hooks, and AbortSignal.
   * 
   * @param toolCalls - Array of tool calls to execute
   * @param options.signal - Optional AbortSignal for cancellation
   * @param options.sessionId - Optional session ID passed to hooks
   * @returns Array of tool results
   * @throws {ValidationError} if tool is not registered or batch cap exceeded
   * 
   * Validates: Requirements 4.1, 4.2, 4.3, 4.5, 4.6, 4.7, 7.4, 9.3, 9.4, 10.4, 12.5
   */
  async execute(
    toolCalls: ToolCall[],
    options?: { signal?: AbortSignal; sessionId?: string },
  ): Promise<ToolResult[]> {
    // Enforce per-batch tool call cap (OpenPilot Constraint 2)
    if (toolCalls.length > this.maxToolCallsPerBatch) {
      throw new ValidationError(
        `Tool call batch size (${toolCalls.length}) exceeds maximum of ${this.maxToolCallsPerBatch} per iteration`,
      );
    }

    // Validate all tools are registered before execution
    for (const toolCall of toolCalls) {
      if (!this.tools.has(toolCall.name)) {
        throw new ValidationError(`Tool '${toolCall.name}' is not registered`);
      }
    }

    // Execute all tool calls in parallel using Promise.all
    const executionPromises = toolCalls.map(async (toolCall): Promise<ToolResult> => {
      const tool = this.tools.get(toolCall.name)!;

      // Build hook context
      let ctx: ToolCallContext = {
        toolName: toolCall.name,
        arguments: { ...toolCall.arguments },
        sessionId: options?.sessionId,
      };

      try {
        // --- before_tool_call hooks ---
        for (const hook of this.beforeHooks) {
          const hookResult = await hook(ctx);
          if (hookResult === false) {
            // Hook blocked execution (e.g. Human-in-the-loop denial)
            const blockedResult: ToolResult = {
              id: toolCall.id,
              error: 'Tool execution blocked by policy hook',
            };
            // Still run after hooks so audit logging works
            for (const afterHook of this.afterHooks) {
              await afterHook(ctx, blockedResult).catch(() => {});
            }
            return blockedResult;
          }
          if (typeof hookResult === 'object' && hookResult !== null) {
            // Hook rewrote the context
            ctx = hookResult;
          }
        }

        // Validate tool parameters against schema
        this.validateToolParameters(ctx.arguments, tool.parameters);

        // Execute tool with 30-second timeout + AbortSignal
        const result = await this.executeWithTimeout(
          tool.execute(ctx.arguments),
          30000,
          options?.signal,
        );

        const toolResult: ToolResult = { id: toolCall.id, result };

        // --- after_tool_call hooks ---
        for (const afterHook of this.afterHooks) {
          await afterHook(ctx, toolResult).catch(() => {});
        }

        return toolResult;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const toolResult: ToolResult = { id: toolCall.id, error: errorMessage };

        // Run after hooks even on failure (for audit)
        for (const afterHook of this.afterHooks) {
          await afterHook(ctx, toolResult).catch(() => {});
        }

        return toolResult;
      }
    });

    return Promise.all(executionPromises);
  }

  /**
   * Validate tool parameters against schema
   * 
   * @param params - The parameters to validate
   * @param schema - The parameter schema
   * @throws {ValidationError} if validation fails
   * 
   * Validates: Requirements 9.3, 9.4
   */
  private validateToolParameters(params: Record<string, any>, schema: ToolParameters): void {
    // Check required parameters are present
    if (schema.required) {
      for (const requiredParam of schema.required) {
        if (!(requiredParam in params)) {
          throw new ValidationError(`Missing required parameter: ${requiredParam}`);
        }
      }
    }

    // Basic type validation for properties
    if (schema.properties) {
      for (const [key, value] of Object.entries(params)) {
        if (!(key in schema.properties)) {
          throw new ValidationError(`Unknown parameter: ${key}`);
        }
      }
    }
  }

  /**
   * Execute a promise with timeout and optional AbortSignal
   * 
   * @param promise - The promise to execute
   * @param timeoutMs - Timeout in milliseconds
   * @param signal - Optional AbortSignal for external cancellation
   * @returns The promise result
   * @throws {Error} if timeout is exceeded or signal is aborted
   * 
   * Validates: Requirements 10.4
   */
  private async executeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<T> {
    // Check if already aborted
    if (signal?.aborted) {
      throw new Error('Tool execution aborted');
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortHandler: (() => void) | undefined;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Tool execution timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      });

      const racers: Promise<T | never>[] = [promise, timeoutPromise];

      if (signal) {
        const abortPromise = new Promise<never>((_, reject) => {
          abortHandler = () => reject(new Error('Tool execution aborted'));
          signal.addEventListener('abort', abortHandler, { once: true });
        });
        racers.push(abortPromise);
      }

      return await Promise.race(racers);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abortHandler && signal) {
        signal.removeEventListener('abort', abortHandler);
      }
    }
  }
}
