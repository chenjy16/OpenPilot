/**
 * Core type definitions for AI Assistant MVP
 */

/**
 * Message role types
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * Message in a conversation
 */
export interface Message {
  role: MessageRole;
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

/**
 * Tool call request from AI model
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  id: string;
  result?: any;
  error?: string;
}

/**
 * Token usage statistics
 */
export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Session metadata
 */
export interface SessionMetadata {
  model: string;
  totalTokens: number;
  cost: number;
}

/**
 * Conversation session
 */
export interface Session {
  id: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
  metadata: SessionMetadata;
}

/**
 * AI request from client
 */
export interface AIRequest {
  sessionId: string;
  message: string;
  model: string;
  tools?: Tool[];
  abortSignal?: AbortSignal;
  /** Optional agent ID — when set, agent-specific config (model, tools, personality) is applied */
  agentId?: string;
}

/**
 * AI response to client
 */
export interface AIResponse {
  text: string;
  usage: Usage;
  toolCalls?: ToolCall[];
  /** Present when this chunk represents a tool call result (not a text delta). */
  toolCallResult?: { id: string; result?: any; error?: string };
}

/**
 * Tool parameter schema
 */
export interface ToolParameters {
  type: 'object';
  properties: Record<string, any>;
  required?: string[];
}

/**
 * Tool definition
 */
export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
  execute: (params: any) => Promise<any>;
}

/**
 * Model provider type — extensible provider identifier.
 * Core providers have dedicated implementations; others use OpenAI-compatible API.
 */
export type ModelProviderType =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'ollama'
  | 'openrouter'
  | 'amazon-bedrock'
  | 'github-copilot'
  | 'together'
  | 'moonshot'
  | 'doubao'
  | 'deepseek'
  | 'minimax'
  | 'qianfan'
  | string;  // extensible — any provider ID is valid

/**
 * Model API protocol — how to talk to the provider.
 */
export type ModelApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'ollama'
  | 'bedrock-converse-stream';

/**
 * Model configuration
 */
export interface ModelConfig {
  provider: ModelProviderType;
  model: string;
  apiKey: string;
  maxTokens: number;
  temperature: number;
  /** API protocol (defaults based on provider) */
  api?: ModelApi;
  /** Custom base URL for the provider */
  baseUrl?: string;
}

/**
 * Model catalog entry — rich metadata for UI and runtime.
 */
export interface ModelCatalogEntry {
  /** Unique ref: "provider/modelId" */
  ref: string;
  provider: string;
  modelId: string;
  name: string;
  api: ModelApi;
  reasoning: boolean;
  input: Array<'text' | 'image' | 'audio'>;
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  configured: boolean;
  /** Provider display label */
  providerLabel?: string;
}

/**
 * Model reference — parsed "provider/modelId" format.
 */
export interface ModelRef {
  provider: string;
  modelId: string;
}

/**
 * Parse a model reference string into provider and modelId.
 * Supports: "provider/model-id", "model-id" (legacy, provider inferred).
 */
export function parseModelRef(raw: string): ModelRef {
  const slashIdx = raw.indexOf('/');
  if (slashIdx > 0) {
    return { provider: raw.slice(0, slashIdx), modelId: raw.slice(slashIdx + 1) };
  }
  // Legacy: infer provider from model name
  if (raw.startsWith('claude')) return { provider: 'anthropic', modelId: raw };
  if (raw.startsWith('gpt') || raw.startsWith('o1') || raw.startsWith('o3')) return { provider: 'openai', modelId: raw };
  if (raw.startsWith('gemini')) return { provider: 'google', modelId: raw };
  if (raw.startsWith('deepseek')) return { provider: 'deepseek', modelId: raw };
  return { provider: 'openai', modelId: raw };
}

/**
 * Format a ModelRef back to string.
 */
export function formatModelRef(ref: ModelRef): string {
  return `${ref.provider}/${ref.modelId}`;
}

/**
 * Validation error class
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validates a Message object
 * @throws {ValidationError} if validation fails
 */
export function validateMessage(message: Message): void {
  // Validate role
  const validRoles: MessageRole[] = ['user', 'assistant', 'system'];
  if (!validRoles.includes(message.role)) {
    throw new ValidationError(
      `Invalid message role: ${message.role}. Must be one of: ${validRoles.join(', ')}`
    );
  }

  // Validate content is not empty string
  if (typeof message.content !== 'string' || message.content === '') {
    throw new ValidationError('Message content must be a non-empty string');
  }

  // Validate timestamp
  if (!(message.timestamp instanceof Date) || isNaN(message.timestamp.getTime())) {
    throw new ValidationError('Message timestamp must be a valid Date object');
  }
}

/**
 * Validates a ToolCall object
 * @param toolCall - The tool call to validate
 * @param registeredTools - Optional set of registered tool names for validation
 * @throws {ValidationError} if validation fails
 */
export function validateToolCall(toolCall: ToolCall, registeredTools?: Set<string>): void {
  // Validate ID is not empty
  if (typeof toolCall.id !== 'string' || toolCall.id === '') {
    throw new ValidationError('ToolCall id must be a non-empty string');
  }

  // Validate name is not empty
  if (typeof toolCall.name !== 'string' || toolCall.name === '') {
    throw new ValidationError('ToolCall name must be a non-empty string');
  }

  // Validate name is registered (if registry provided)
  if (registeredTools && !registeredTools.has(toolCall.name)) {
    throw new ValidationError(`Tool '${toolCall.name}' is not registered`);
  }

  // Validate arguments is an object
  if (typeof toolCall.arguments !== 'object' || toolCall.arguments === null || Array.isArray(toolCall.arguments)) {
    throw new ValidationError('ToolCall arguments must be a non-null object');
  }
}

/**
 * Validates a ToolResult object
 * @param toolResult - The tool result to validate
 * @param validToolCallIds - Optional set of valid tool call IDs
 * @throws {ValidationError} if validation fails
 */
export function validateToolResult(toolResult: ToolResult, validToolCallIds?: Set<string>): void {
  // Validate ID is not empty
  if (typeof toolResult.id !== 'string' || toolResult.id === '') {
    throw new ValidationError('ToolResult id must be a non-empty string');
  }

  // Validate ID corresponds to a tool call (if IDs provided)
  if (validToolCallIds && !validToolCallIds.has(toolResult.id)) {
    throw new ValidationError(`ToolResult id '${toolResult.id}' does not correspond to any ToolCall`);
  }

  // Validate that at least one of result or error exists
  if (toolResult.result === undefined && toolResult.error === undefined) {
    throw new ValidationError('ToolResult must have either result or error defined');
  }

  // Validate that if error exists, it should be a string
  if (toolResult.error !== undefined && typeof toolResult.error !== 'string') {
    throw new ValidationError('ToolResult error must be a string');
  }
}

/**
 * Validates a Usage object
 * @throws {ValidationError} if validation fails
 */
export function validateUsage(usage: Usage): void {
  // Validate promptTokens is a non-negative integer
  if (!Number.isInteger(usage.promptTokens) || usage.promptTokens < 0) {
    throw new ValidationError('Usage promptTokens must be a non-negative integer');
  }

  // Validate completionTokens is a non-negative integer
  if (!Number.isInteger(usage.completionTokens) || usage.completionTokens < 0) {
    throw new ValidationError('Usage completionTokens must be a non-negative integer');
  }

  // Validate totalTokens is a non-negative integer
  if (!Number.isInteger(usage.totalTokens) || usage.totalTokens < 0) {
    throw new ValidationError('Usage totalTokens must be a non-negative integer');
  }

  // Validate totalTokens equals promptTokens + completionTokens
  const expectedTotal = usage.promptTokens + usage.completionTokens;
  if (usage.totalTokens !== expectedTotal) {
    throw new ValidationError(
      `Usage totalTokens (${usage.totalTokens}) must equal promptTokens (${usage.promptTokens}) + completionTokens (${usage.completionTokens}) = ${expectedTotal}`
    );
  }
}

/**
 * Type guard to check if a value is a valid MessageRole
 */
export function isMessageRole(value: any): value is MessageRole {
  return value === 'user' || value === 'assistant' || value === 'system';
}
