/**
 * PiAgent — the core ReAct loop engine.
 *
 * Mirrors @mariozechner/pi-agent-core PiAgent.
 * Drives the inference → tool-call → feedback cycle until the model
 * produces a final answer or the iteration cap is reached.
 */

import { PiSession } from './PiSession';
import {
  PiAgentConfig,
  PiAgentResult,
  PiTool,
  PiToolCall,
  PiToolResult,
  PiToolContext,
  PiModelProvider,
  PiOnUpdateCallback,
  PiStreamEvent,
  TranscriptMessage,
  PiToolUpdateCallback,
} from './types';
import {
  estimateTranscriptTokens,
  CONTEXT_USAGE_THRESHOLD,
} from './tokenEstimator';

export class PiAgent {
  private model: PiModelProvider;
  private systemPrompt: string;
  private tools: Map<string, PiTool>;
  private maxToolCallsPerLoop: number;
  private contextWindowTokens: number;
  private onContextOverflow?: (sessionId: string) => Promise<boolean>;

  constructor(config: PiAgentConfig) {
    this.model = config.model;
    this.systemPrompt = config.systemPrompt;
    this.tools = new Map(config.tools.map(t => [t.name, t]));
    this.maxToolCallsPerLoop = config.maxToolCallsPerLoop;
    this.contextWindowTokens = config.contextWindowTokens ?? 128_000;
    this.onContextOverflow = config.onContextOverflow;
  }

  /**
   * Run the ReAct loop (non-streaming).
   *
   * 1. Inject system prompt + session transcript + user message
   * 2. Call model
   * 3. If tool calls → execute tools → append results → loop
   * 4. If no tool calls → final answer → exit
   */
  async run(opts: {
    session: PiSession;
    message: string;
    onUpdate?: PiOnUpdateCallback;
    abortSignal?: AbortSignal;
  }): Promise<PiAgentResult> {
    const { session, message, onUpdate, abortSignal } = opts;

    // Append user message to transcript
    session.append({ role: 'user', content: message });

    let totalTokensUsed = 0;
    let finalText = '';
    let stopReason: PiAgentResult['stopReason'] = 'completed';

    for (let i = 0; i < this.maxToolCallsPerLoop; i++) {
      // Check abort — return gracefully instead of throwing
      if (abortSignal?.aborted) {
        stopReason = 'aborted';
        break;
      }

      // Context window guard — compact if approaching limit
      await this.checkContextGuard(session);

      // Build messages array: system + transcript
      const messages = this.buildMessages(session);

      // Call model
      const response = await this.model.call(messages);
      totalTokensUsed += response.usage.totalTokens;

      // No tool calls → final answer
      if (!response.toolCalls || response.toolCalls.length === 0) {
        finalText = response.text;
        stopReason = 'completed';
        session.append({ role: 'assistant', content: response.text });
        break;
      }

      // Tool calls present — execute them
      const assistantMsg: TranscriptMessage = {
        role: 'assistant',
        content: response.text,
        toolCalls: response.toolCalls,
      };
      session.append(assistantMsg);

      const toolResults = await this.executeTools(
        response.toolCalls,
        session.sessionId,
        onUpdate,
        abortSignal,
      );

      const toolResultMsg: TranscriptMessage = {
        role: 'user',
        content: '',
        toolResults,
      };
      session.append(toolResultMsg);

      // Last iteration — force exit
      if (i === this.maxToolCallsPerLoop - 1) {
        finalText = response.text;
        stopReason = 'max_iterations';
      }
    }

    return {
      finalText,
      transcript: session.getTranscript(),
      totalTokensUsed,
      stopReason,
    };
  }

  /**
   * Run the ReAct loop with streaming.
   * Yields text deltas as they arrive. Tool call iterations are
   * handled internally; each iteration's text chunks are yielded.
   */
  async *runStreaming(opts: {
    session: PiSession;
    message: string;
    onUpdate?: PiOnUpdateCallback;
    abortSignal?: AbortSignal;
  }): AsyncGenerator<PiStreamEvent> {
    const { session, message, onUpdate, abortSignal } = opts;

    session.append({ role: 'user', content: message });

    let totalTokensUsed = 0;
    let finalText = '';
    let stopReason: PiAgentResult['stopReason'] = 'completed';

    for (let i = 0; i < this.maxToolCallsPerLoop; i++) {
      if (abortSignal?.aborted) {
        stopReason = 'aborted';
        break;
      }

      // Context window guard — compact if approaching limit
      await this.checkContextGuard(session);

      const messages = this.buildMessages(session);

      // Stream from model
      const chunks: { text: string; toolCalls?: PiToolCall[]; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }[] = [];
      for await (const chunk of this.model.stream(messages)) {
        chunks.push(chunk);
        if (chunk.text) {
          yield { type: 'text_delta', text: chunk.text };
          onUpdate?.({ type: 'text_delta', text: chunk.text });
        }
      }

      const lastChunk = chunks[chunks.length - 1];
      const usage = lastChunk?.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      totalTokensUsed += usage.totalTokens;
      const passText = chunks.map(c => c.text).join('');
      const toolCalls = lastChunk?.toolCalls;

      if (!toolCalls || toolCalls.length === 0) {
        finalText = passText;
        stopReason = 'completed';
        session.append({ role: 'assistant', content: passText });
        break;
      }

      // Notify tool call starts
      for (const tc of toolCalls) {
        const startEvt = { type: 'tool_call_start' as const, toolName: tc.name, args: tc.args, id: tc.id };
        yield startEvt;
        onUpdate?.(startEvt);
      }

      const assistantMsg: TranscriptMessage = {
        role: 'assistant',
        content: passText,
        toolCalls,
      };
      session.append(assistantMsg);

      const toolResults = await this.executeTools(
        toolCalls,
        session.sessionId,
        onUpdate,
        abortSignal,
      );

      // Yield tool_call_result events
      for (const tr of toolResults) {
        yield { type: 'tool_call_result', id: tr.id, result: tr.result, error: tr.error };
      }

      session.append({ role: 'user', content: '', toolResults });

      if (i === this.maxToolCallsPerLoop - 1) {
        finalText = passText;
        stopReason = 'max_iterations';
      }
    }

    yield {
      type: 'done',
      result: { finalText, transcript: session.getTranscript(), totalTokensUsed, stopReason },
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildMessages(session: PiSession): TranscriptMessage[] {
    return [
      { role: 'system', content: this.systemPrompt },
      ...session.getTranscript(),
    ];
  }

  /**
   * Check if context usage is approaching the window limit.
   * If so, invoke the onContextOverflow callback to compact.
   * Returns true if compaction was triggered and succeeded.
   * Throws if context is over limit and compaction fails.
   *
   * OpenPilot equivalent: compaction-safeguard extension
   */
  private async checkContextGuard(session: PiSession): Promise<boolean> {
    if (!this.onContextOverflow) return false;

    const estimated = estimateTranscriptTokens(
      this.systemPrompt,
      session.getTranscript(),
    );
    const threshold = Math.floor(this.contextWindowTokens * CONTEXT_USAGE_THRESHOLD);

    if (estimated >= threshold) {
      const compacted = await this.onContextOverflow(session.sessionId);
      if (!compacted && estimated >= this.contextWindowTokens * 0.95) {
        // Context is critically full and compaction failed — stop to avoid model error
        throw new Error(`Context window nearly full (${estimated} tokens) and compaction failed. Please start a new session.`);
      }
      return compacted;
    }
    return false;
  }

  private async executeTools(
    toolCalls: PiToolCall[],
    sessionId: string,
    onUpdate?: PiOnUpdateCallback,
    abortSignal?: AbortSignal,
  ): Promise<PiToolResult[]> {
    const ctx: PiToolContext = { sessionId, abortSignal };

    const results = await Promise.all(
      toolCalls.map(async (tc): Promise<PiToolResult> => {
        const tool = this.tools.get(tc.name);
        if (!tool) {
          const result: PiToolResult = { id: tc.id, error: `Tool '${tc.name}' not found` };
          onUpdate?.({ type: 'tool_call_result', id: tc.id, result: null, error: result.error });
          return result;
        }
        try {
          const execResult = await tool.execute(tc.args, ctx);
          const result: PiToolResult = { id: tc.id, result: execResult };
          onUpdate?.({ type: 'tool_call_result', id: tc.id, result: execResult });
          return result;
        } catch (err: any) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          const result: PiToolResult = { id: tc.id, error: errorMsg };
          onUpdate?.({ type: 'tool_call_result', id: tc.id, result: null, error: errorMsg });
          return result;
        }
      }),
    );

    return results;
  }
}
