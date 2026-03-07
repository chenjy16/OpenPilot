/**
 * OpenAI Provider
 * Implementation of ModelProvider for OpenAI models
 */

import OpenAI from 'openai';
import { ModelProvider } from './ModelProvider';
import { Message, AIResponse, Tool, ToolCall } from '../types';

/**
 * OpenAI provider implementation
 * Supports OpenAI models like gpt-3.5-turbo and gpt-4
 */
export class OpenAIProvider extends ModelProvider {
  private client: OpenAI;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor(apiKey: string, model: string, maxTokens: number = 2000, temperature: number = 0.7, baseUrl?: string) {
    super();
    const opts: ConstructorParameters<typeof OpenAI>[0] = { apiKey };
    if (baseUrl) opts.baseURL = baseUrl;
    this.client = new OpenAI(opts);
    this.model = model;
    this.maxTokens = maxTokens;
    this.temperature = temperature;
  }

  /**
   * Call OpenAI API with messages and optional tools
   */
  async call(messages: Message[], tools?: Tool[]): Promise<AIResponse> {
    try {
      // Convert messages to OpenAI format
      const openaiMessages = this.convertMessages(messages);

      // Prepare request parameters
      const params: OpenAI.Chat.ChatCompletionCreateParams = {
        model: this.model,
        messages: openaiMessages,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
      };

      // Add tools if provided
      if (tools && tools.length > 0) {
        params.tools = this.convertTools(tools);
      }

      // Call OpenAI API
      const response = await this.client.chat.completions.create(params);

      // Convert response to AIResponse format
      return this.convertResponse(response);
    } catch (error: any) {
      // Handle errors using inherited error handling
      this.handleError(error);
    }
  }

  /**
   * Stream OpenAI API response with messages and optional tools
   * Yields incremental AIResponse chunks as they arrive
   */
  async *stream(messages: Message[], tools?: Tool[]): AsyncGenerator<AIResponse> {
    try {
      const openaiMessages = this.convertMessages(messages);

      const params: OpenAI.Chat.ChatCompletionCreateParams = {
        model: this.model,
        messages: openaiMessages,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        stream: true,
      };

      if (tools && tools.length > 0) {
        params.tools = this.convertTools(tools);
      }

      const stream = await this.client.chat.completions.create(params as any);

      let promptTokens = 0;
      let completionTokens = 0;
      // Accumulate tool call fragments keyed by index
      const toolCallAccumulator: Record<number, { id: string; name: string; argumentsRaw: string }> = {};

      for await (const chunk of stream as any) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // Accumulate tool call fragments
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallAccumulator[idx]) {
              toolCallAccumulator[idx] = { id: tc.id ?? '', name: tc.function?.name ?? '', argumentsRaw: '' };
            }
            if (tc.id) toolCallAccumulator[idx].id = tc.id;
            if (tc.function?.name) toolCallAccumulator[idx].name += tc.function.name;
            if (tc.function?.arguments) toolCallAccumulator[idx].argumentsRaw += tc.function.arguments;
          }
        }

        // Yield text chunks
        const text = delta.content ?? '';
        if (text) {
          yield {
            text,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          };
        }

        // Capture usage from the final chunk
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens ?? 0;
          completionTokens = chunk.usage.completion_tokens ?? 0;
        }
      }

      // Build final tool calls if any were accumulated
      const toolCalls = Object.values(toolCallAccumulator).length > 0
        ? Object.values(toolCallAccumulator).map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: (() => {
              try { return JSON.parse(tc.argumentsRaw); } catch { return {}; }
            })(),
          }))
        : undefined;

      // Yield final chunk with usage stats and tool calls
      yield {
        text: '',
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        toolCalls,
      };
    } catch (error: any) {
      this.handleError(error);
    }
  }

  /**
   * Convert internal Message format to OpenAI message format
   */
  private convertMessages(messages: Message[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    const result: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    for (const msg of messages) {
      // Tool result messages → OpenAI 'tool' role messages
      if (msg.role === 'user' && msg.toolResults && msg.toolResults.length > 0) {
        for (const tr of msg.toolResults) {
          result.push({
            role: 'tool' as const,
            tool_call_id: tr.id,
            content: tr.error ? `Error: ${tr.error}` : (typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)),
          });
        }
        // If there's also text content, add it as a separate user message
        if (msg.content && msg.content.trim() !== '') {
          result.push({ role: 'user', content: msg.content });
        }
        continue;
      }

      const baseMessage: any = {
        role: msg.role,
        content: msg.content,
      };

      // Add tool calls if present (for assistant messages)
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        baseMessage.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
      }

      result.push(baseMessage);
    }

    return result;
  }

  /**
   * Convert internal Tool format to OpenAI tool format
   */
  private convertTools(tools: Tool[]): OpenAI.Chat.ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as unknown as Record<string, unknown>,
      },
    }));
  }

  /**
   * Convert OpenAI response to internal AIResponse format
   */
  private convertResponse(response: OpenAI.Chat.ChatCompletion): AIResponse {
    const choice = response.choices[0];
    const message = choice.message;

    // Extract text content
    const text = message.content || '';

    // Extract tool calls if present
    let toolCalls: ToolCall[] | undefined;
    if (message.tool_calls && message.tool_calls.length > 0) {
      toolCalls = message.tool_calls.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      }));
    }

    // Extract usage statistics
    const usage = {
      promptTokens: response.usage?.prompt_tokens || 0,
      completionTokens: response.usage?.completion_tokens || 0,
      totalTokens: response.usage?.total_tokens || 0,
    };

    return {
      text,
      usage,
      toolCalls,
    };
  }
}
