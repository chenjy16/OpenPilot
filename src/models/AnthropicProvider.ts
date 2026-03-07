/**
 * Anthropic Provider
 * Implementation of ModelProvider for Anthropic models using the Messages API
 */

import Anthropic from '@anthropic-ai/sdk';
import { ModelProvider } from './ModelProvider';
import { Message, AIResponse, Tool, ToolCall } from '../types';

/**
 * Anthropic provider implementation
 * Supports Anthropic models like claude-3-sonnet and claude-3-opus
 * Uses the modern Messages API
 */
export class AnthropicProvider extends ModelProvider {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor(apiKey: string, model: string, maxTokens: number = 4000, temperature: number = 0.5) {
    super();
    this.client = new Anthropic({ apiKey });
    this.model = model;
    this.maxTokens = maxTokens;
    this.temperature = temperature;
  }

  /**
   * Call Anthropic Messages API with messages and optional tools
   */
  async call(messages: Message[], tools?: Tool[]): Promise<AIResponse> {
    try {
      // Extract system messages (Anthropic takes system as top-level param)
      const systemMessages = messages.filter((msg) => msg.role === 'system');
      const system = systemMessages.length > 0
        ? systemMessages.map((msg) => msg.content).join('\n\n')
        : undefined;

      // Convert non-system messages to Anthropic format
      const anthropicMessages = this.convertMessages(
        messages.filter((msg) => msg.role !== 'system')
      );

      // Prepare request parameters
      const params: any = {
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        messages: anthropicMessages,
      };

      if (system) {
        params.system = system;
      }

      // Add tools if provided
      if (tools && tools.length > 0) {
        params.tools = this.convertTools(tools);
      }

      // Call Anthropic Messages API
      const response = await this.client.messages.create(params);

      // Convert response to AIResponse format
      return this.convertResponse(response);
    } catch (error: any) {
      this.handleError(error);
    }
  }

  /**
   * Stream Anthropic Messages API response with messages and optional tools
   * Yields incremental AIResponse chunks as they arrive
   */
  async *stream(messages: Message[], tools?: Tool[]): AsyncGenerator<AIResponse> {
    try {
      const systemMessages = messages.filter((msg) => msg.role === 'system');
      const system = systemMessages.length > 0
        ? systemMessages.map((msg) => msg.content).join('\n\n')
        : undefined;

      const anthropicMessages = this.convertMessages(
        messages.filter((msg) => msg.role !== 'system')
      );

      const params: any = {
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        messages: anthropicMessages,
        stream: true,
      };

      if (system) params.system = system;
      if (tools && tools.length > 0) params.tools = this.convertTools(tools);

      const stream = await this.client.messages.create(params);

      let promptTokens = 0;
      let completionTokens = 0;
      const toolCalls: Array<{ id: string; name: string; arguments: Record<string, any> }> = [];
      // Accumulate tool input JSON per tool_use block index
      const toolInputAccumulator: Record<number, string> = {};
      let currentToolIndex = -1;

      for await (const event of stream as any) {
        switch (event.type) {
          case 'content_block_start':
            if (event.content_block?.type === 'tool_use') {
              currentToolIndex = event.index ?? toolCalls.length;
              toolCalls.push({
                id: event.content_block.id,
                name: event.content_block.name,
                arguments: {},
              });
              toolInputAccumulator[currentToolIndex] = '';
            }
            break;

          case 'content_block_delta':
            if (event.delta?.type === 'text_delta' && event.delta.text) {
              yield {
                text: event.delta.text,
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
              };
            } else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
              const idx = event.index ?? currentToolIndex;
              toolInputAccumulator[idx] = (toolInputAccumulator[idx] ?? '') + event.delta.partial_json;
            }
            break;

          case 'message_delta':
            if (event.usage) {
              completionTokens = event.usage.output_tokens ?? 0;
            }
            break;

          case 'message_start':
            if (event.message?.usage) {
              promptTokens = event.message.usage.input_tokens ?? 0;
            }
            break;
        }
      }

      // Finalize tool call arguments
      for (const [idxStr, rawJson] of Object.entries(toolInputAccumulator)) {
        const idx = parseInt(idxStr, 10);
        if (toolCalls[idx]) {
          try {
            toolCalls[idx].arguments = JSON.parse(rawJson);
          } catch {
            toolCalls[idx].arguments = {};
          }
        }
      }

      // Yield final chunk with usage stats and tool calls
      yield {
        text: '',
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    } catch (error: any) {
      this.handleError(error);
    }
  }

  /**
   * Convert internal Message format to Anthropic messages format
   */
  private convertMessages(messages: Message[]): any[] {
    return messages.map((msg) => {
      const content: any[] = [];

      // Add tool_result blocks for user messages with tool results
      // (must come before text to match Anthropic's expected ordering)
      if (msg.role === 'user' && msg.toolResults && msg.toolResults.length > 0) {
        msg.toolResults.forEach((tr) => {
          content.push({
            type: 'tool_result',
            tool_use_id: tr.id,
            content: tr.error ? `Error: ${tr.error}` : JSON.stringify(tr.result),
          });
        });
      }

      // Add text content block (skip empty text when tool results are present)
      if (msg.content !== undefined && msg.content !== '') {
        content.push({ type: 'text', text: msg.content });
      }

      // Add tool_use blocks for assistant messages with tool calls
      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        msg.toolCalls.forEach((tc) => {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        });
      }

      // Ensure at least one content block (Anthropic requires non-empty content)
      if (content.length === 0) {
        content.push({ type: 'text', text: ' ' });
      }

      return {
        role: msg.role as 'user' | 'assistant',
        content,
      };
    });
  }

  /**
   * Convert internal Tool format to Anthropic tool format
   */
  private convertTools(tools: Tool[]): any[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }

  /**
   * Convert Anthropic Messages API response to internal AIResponse format
   */
  private convertResponse(response: any): AIResponse {
    let text = '';
    const toolCalls: ToolCall[] = [];

    // Process content blocks
    if (response.content && Array.isArray(response.content)) {
      for (const block of response.content) {
        if (block.type === 'text') {
          text += block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input,
          });
        }
      }
    }

    // Extract usage statistics
    const usage = {
      promptTokens: response.usage?.input_tokens || 0,
      completionTokens: response.usage?.output_tokens || 0,
      totalTokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    };

    return {
      text,
      usage,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}
