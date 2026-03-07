/**
 * @mariozechner/pi-agent-core type definitions
 *
 * Local shim of the Pi Agent Runtime interfaces, aligned with the real
 * pi-agent-core package as used in the OpenPilot codebase.
 *
 * Real package imports observed in OpenPilot source:
 *   import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
 *   import type { AgentSession, ToolDefinition } from "@mariozechner/pi-coding-agent";
 *
 * Our local shim uses "Pi" prefixed names to avoid collisions with our
 * existing app-level types. The MODE B switch in index.ts re-exports
 * the real package types under these same names.
 */

// ---------------------------------------------------------------------------
// Transcript (conversation history)
// ---------------------------------------------------------------------------

export interface TranscriptMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  toolCalls?: PiToolCall[];
  toolResults?: PiToolResult[];
}

export interface PiToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface PiToolResult {
  id: string;
  result?: any;
  error?: string;
}

// ---------------------------------------------------------------------------
// Tool result format (aligned with real AgentToolResult<T>)
// ---------------------------------------------------------------------------

/**
 * Mirrors AgentToolResult<T> from @mariozechner/pi-agent-core.
 * The real package returns tool results with a `content[]` array
 * containing text/image blocks, plus optional `details`.
 */
export interface PiToolResultContent {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; url: string }>;
  details?: unknown;
}

// ---------------------------------------------------------------------------
// Tool definition (Pi-native format)
// ---------------------------------------------------------------------------

export interface PiToolSchema {
  type: 'object';
  properties: Record<string, any>;
  required?: string[];
}

/**
 * Mirrors AgentTool from @mariozechner/pi-agent-core.
 *
 * Real signature: execute(toolCallId, params, signal?, onUpdate?)
 * Our shim uses a context object for ergonomics, but the adapter
 * layer bridges to the real signature when switching to MODE B.
 */
export interface PiTool {
  name: string;
  description: string;
  /** label is optional display name (real package: tool.label ?? tool.name) */
  label?: string;
  schema: PiToolSchema;
  execute: (args: Record<string, any>, context: PiToolContext) => Promise<any>;
}

export interface PiToolContext {
  sessionId: string;
  toolCallId?: string;
  abortSignal?: AbortSignal;
  onUpdate?: PiToolUpdateCallback;
}

/**
 * Mirrors AgentToolUpdateCallback<T> from @mariozechner/pi-agent-core.
 * Called during long-running tool execution to stream partial results.
 */
export type PiToolUpdateCallback = (update: unknown) => void;

// ---------------------------------------------------------------------------
// Streaming update events (onUpdate callback)
// ---------------------------------------------------------------------------

export type PiUpdateEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_start'; toolName: string; args: Record<string, any>; id: string }
  | { type: 'tool_call_result'; id: string; result: any; error?: string }
  | { type: 'error'; error: string };

export type PiOnUpdateCallback = (event: PiUpdateEvent) => void;

// ---------------------------------------------------------------------------
// Model interface — what PiAgent uses to talk to LLMs
// ---------------------------------------------------------------------------

export interface PiModelResponse {
  text: string;
  toolCalls?: PiToolCall[];
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface PiModelProvider {
  /** Non-streaming call */
  call(messages: TranscriptMessage[]): Promise<PiModelResponse>;
  /** Streaming call — yields text deltas, final chunk has usage + toolCalls */
  stream(messages: TranscriptMessage[]): AsyncGenerator<PiModelResponse>;
}

// ---------------------------------------------------------------------------
// PiAgent configuration
// ---------------------------------------------------------------------------

export interface PiAgentConfig {
  model: PiModelProvider;
  systemPrompt: string;
  tools: PiTool[];
  maxToolCallsPerLoop: number;
  onUpdate?: PiOnUpdateCallback;
  abortSignal?: AbortSignal;
  /** Context window size in tokens. Used for auto-compaction guard. */
  contextWindowTokens?: number;
  /**
   * Called when context usage exceeds the safety threshold.
   * Should compact the session and return true if compaction succeeded.
   * If not provided or returns false, the agent continues without compaction.
   */
  onContextOverflow?: (sessionId: string) => Promise<boolean>;
}

// ---------------------------------------------------------------------------
// PiAgent.run() result
// ---------------------------------------------------------------------------

export interface PiAgentResult {
  finalText: string;
  transcript: TranscriptMessage[];
  totalTokensUsed: number;
  /** Stop reason for the agent run (aligned with real EmbeddedPiRunMeta) */
  stopReason?: 'completed' | 'tool_calls' | 'max_iterations' | 'aborted' | 'context_overflow';
}

// ---------------------------------------------------------------------------
// Streaming generator event types (yielded by PiAgent.runStreaming)
// ---------------------------------------------------------------------------

export type PiStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_start'; toolName: string; args: Record<string, any>; id: string }
  | { type: 'tool_call_result'; id: string; result: any; error?: string }
  | { type: 'done'; result: PiAgentResult };
