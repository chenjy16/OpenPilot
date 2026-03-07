/**
 * Adapters — bridge between our existing ModelProvider/ToolExecutor
 * and the Pi Agent Core interfaces.
 *
 * Includes a zod adapter layer: when switching to the real
 * @mariozechner/pi-agent-core package, tool schemas must be z.ZodObject
 * instances. The jsonSchemaToZod() helper converts our JSON Schema tool
 * definitions into zod objects at runtime.
 */

import { ModelProvider } from '../models/ModelProvider';
import { ToolExecutor } from '../tools/ToolExecutor';
import { Message, Tool as AppTool } from '../types';
import {
  PiModelProvider,
  PiModelResponse,
  PiTool,
  PiToolSchema,
  PiToolResultContent,
  TranscriptMessage,
} from './types';

// ---------------------------------------------------------------------------
// ModelProvider → PiModelProvider adapter
// ---------------------------------------------------------------------------

/**
 * Wraps our existing ModelProvider (OpenAI/Anthropic/Gemini) so PiAgent
 * can call it through the PiModelProvider interface.
 *
 * Tools are forwarded to the underlying provider so the LLM knows
 * which functions it can call.
 */
export class ModelProviderAdapter implements PiModelProvider {
  private appTools?: AppTool[];

  constructor(
    private provider: ModelProvider,
    appTools?: AppTool[],
  ) {
    this.appTools = appTools;
  }

  /** Update the tools list (used when retry logic rebuilds the adapter) */
  setTools(tools: AppTool[] | undefined): void {
    this.appTools = tools;
  }

  async call(messages: TranscriptMessage[]): Promise<PiModelResponse> {
    const appMessages = toAppMessages(messages);
    const response = await this.provider.call(appMessages, this.appTools);
    return {
      text: response.text,
      toolCalls: response.toolCalls?.map(tc => ({
        id: tc.id,
        name: tc.name,
        args: tc.arguments,
      })),
      usage: response.usage,
    };
  }

  async *stream(messages: TranscriptMessage[]): AsyncGenerator<PiModelResponse> {
    const appMessages = toAppMessages(messages);
    for await (const chunk of this.provider.stream(appMessages, this.appTools)) {
      yield {
        text: chunk.text,
        toolCalls: chunk.toolCalls?.map(tc => ({
          id: tc.id,
          name: tc.name,
          args: tc.arguments,
        })),
        usage: chunk.usage,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// ToolExecutor tools → PiTool[] adapter
// ---------------------------------------------------------------------------

/**
 * Convert our app-level Tool (with ToolExecutor hooks/timeout) into PiTool[].
 * The PiTool.execute delegates to ToolExecutor.execute() so that
 * before/after hooks, timeout, and AbortSignal all still apply.
 *
 * If appTools is provided, only those tools are exposed (intersection with registered).
 * If appTools is undefined/empty, ALL registered tools are exposed to the agent.
 */
export function toPiTools(toolExecutor: ToolExecutor, appTools?: AppTool[]): PiTool[] {
  // If explicit tool list provided, use intersection with registered tools
  if (appTools && appTools.length > 0) {
    return appTools
      .filter(t => toolExecutor.hasTool(t.name))
      .map((t): PiTool => ({
        name: t.name,
        description: t.description,
        label: t.name,
        schema: t.parameters as PiToolSchema,
        execute: async (args, ctx) => {
          const toolCallId = ctx.toolCallId ?? `pi-${Date.now()}`;
          const results = await toolExecutor.execute(
            [{ id: toolCallId, name: t.name, arguments: args }],
            { signal: ctx.abortSignal, sessionId: ctx.sessionId },
          );
          const r = results[0];
          if (r.error) throw new Error(r.error);
          return r.result;
        },
      }));
  }

  // No explicit tool list — expose ALL registered tools from ToolExecutor
  return toolExecutor.getRegisteredToolNames().map((name): PiTool => {
    const tool = toolExecutor.getTool(name)!;
    return {
      name: tool.name,
      description: tool.description,
      label: tool.name,
      schema: tool.parameters as PiToolSchema,
      execute: async (args, ctx) => {
        const toolCallId = ctx.toolCallId ?? `pi-${Date.now()}`;
        const results = await toolExecutor.execute(
          [{ id: toolCallId, name: tool.name, arguments: args }],
          { signal: ctx.abortSignal, sessionId: ctx.sessionId },
        );
        const r = results[0];
        if (r.error) throw new Error(r.error);
        return r.result;
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Message format converters
// ---------------------------------------------------------------------------

/** TranscriptMessage[] → Message[] (our app format) */
function toAppMessages(transcript: TranscriptMessage[]): Message[] {
  return transcript.map(m => ({
    role: m.role,
    content: m.content,
    timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
    toolCalls: m.toolCalls?.map(tc => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.args,
    })),
    toolResults: m.toolResults?.map(tr => ({
      id: tr.id,
      result: tr.result,
      error: tr.error,
    })),
  }));
}

/** Message[] (our app format) → TranscriptMessage[] */
export function toTranscript(messages: Message[]): TranscriptMessage[] {
  return messages.map(m => ({
    role: m.role,
    content: m.content,
    timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : String(m.timestamp),
    toolCalls: m.toolCalls?.map(tc => ({
      id: tc.id,
      name: tc.name,
      args: tc.arguments,
    })),
    toolResults: m.toolResults?.map(tr => ({
      id: tr.id,
      result: tr.result,
      error: tr.error,
    })),
  }));
}

/** TranscriptMessage[] → Message[] (for persisting back to SessionManager) */
export function fromTranscript(transcript: TranscriptMessage[]): Message[] {
  return toAppMessages(transcript);
}


// ---------------------------------------------------------------------------
// Zod schema adapter (for real @mariozechner/pi-agent-core compatibility)
// ---------------------------------------------------------------------------

/**
 * Convert a JSON Schema object (our app-level tool parameter format) into
 * a zod schema object. This is needed because the real pi-agent-core package
 * requires tool schemas to be z.ZodObject instances.
 *
 * Usage (MODE B only — when switching to real pi-agent-core):
 *   import { z } from 'zod';
 *   const zodSchema = jsonSchemaToZod(tool.parameters);
 *
 * For MODE A (local shim), PiToolSchema is a plain JSON Schema object
 * and this function is not called — toPiTools() passes the schema as-is.
 */
export function jsonSchemaToZod(schema: PiToolSchema): any {
  // Lazy-load zod to avoid hard dependency when running in MODE A
  let z: any;
  try {
    z = require('zod');
  } catch {
    // zod not installed — return the raw schema (MODE A fallback)
    return schema;
  }

  if (!schema || schema.type !== 'object' || !schema.properties) {
    return z.object({});
  }

  const shape: Record<string, any> = {};
  const required = new Set(schema.required ?? []);

  for (const [key, prop] of Object.entries(schema.properties)) {
    let field = jsonSchemaPropertyToZod(z, prop);
    if (!required.has(key)) {
      field = field.optional();
    }
    shape[key] = field;
  }

  return z.object(shape);
}

/**
 * Convert a single JSON Schema property definition to a zod type.
 * Handles the common types used in tool parameter schemas.
 */
function jsonSchemaPropertyToZod(z: any, prop: any): any {
  if (!prop || typeof prop !== 'object') return z.any();

  const desc = prop.description;
  const withDesc = (schema: any) => (desc ? schema.describe(desc) : schema);

  switch (prop.type) {
    case 'string':
      if (prop.enum) return withDesc(z.enum(prop.enum));
      return withDesc(z.string());
    case 'number':
    case 'integer':
      return withDesc(z.number());
    case 'boolean':
      return withDesc(z.boolean());
    case 'array':
      if (prop.items) {
        return withDesc(z.array(jsonSchemaPropertyToZod(z, prop.items)));
      }
      return withDesc(z.array(z.any()));
    case 'object':
      if (prop.properties) {
        const nested: Record<string, any> = {};
        const req = new Set(prop.required ?? []);
        for (const [k, v] of Object.entries(prop.properties)) {
          let f = jsonSchemaPropertyToZod(z, v);
          if (!req.has(k)) f = f.optional();
          nested[k] = f;
        }
        return withDesc(z.object(nested));
      }
      return withDesc(z.record(z.any()));
    default:
      return withDesc(z.any());
  }
}

/**
 * MODE B variant of toPiTools — converts tool schemas to zod objects.
 * Call this instead of toPiTools() when using the real pi-agent-core package.
 */
export function toPiToolsWithZod(toolExecutor: ToolExecutor, appTools?: AppTool[]): PiTool[] {
  // Get the base PiTools first (handles the "all registered" fallback)
  const tools = appTools && appTools.length > 0
    ? appTools.filter(t => toolExecutor.hasTool(t.name))
    : toolExecutor.getRegisteredToolNames().map(name => toolExecutor.getTool(name)!);

  return tools.map((t): PiTool => ({
    name: t.name,
    description: t.description,
    label: t.name,
    schema: jsonSchemaToZod(t.parameters as PiToolSchema),
    execute: async (args, ctx) => {
      const toolCallId = ctx.toolCallId ?? `pi-${Date.now()}`;
      const results = await toolExecutor.execute(
        [{ id: toolCallId, name: t.name, arguments: args }],
        { signal: ctx.abortSignal, sessionId: ctx.sessionId },
      );
      const r = results[0];
      if (r.error) throw new Error(r.error);
      return r.result;
    },
  }));
}

// ---------------------------------------------------------------------------
// Tool result normalization (aligned with real AgentToolResult<T>)
// ---------------------------------------------------------------------------

/**
 * Normalize a raw tool execution result into the AgentToolResult<T> format
 * used by the real @mariozechner/pi-agent-core package.
 *
 * The real package expects: { content: [{ type: 'text', text: '...' }], details?: T }
 * This helper converts our plain string/object results into that format.
 */
export function toToolResultContent(toolName: string, result: unknown): PiToolResultContent {
  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>;
    // Already in content[] format
    if (Array.isArray(record.content)) {
      return result as PiToolResultContent;
    }
    // Wrap object result
    const details = 'details' in record ? record.details : record;
    const safeDetails = details ?? { status: 'ok', tool: toolName };
    return {
      content: [{ type: 'text', text: stringifyPayload(safeDetails) }],
      details: safeDetails,
    };
  }
  const safeDetails = result ?? { status: 'ok', tool: toolName };
  return {
    content: [{ type: 'text', text: stringifyPayload(safeDetails) }],
    details: safeDetails,
  };
}

function stringifyPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  try {
    const encoded = JSON.stringify(payload, null, 2);
    if (typeof encoded === 'string') return encoded;
  } catch { /* fall through */ }
  return String(payload);
}
