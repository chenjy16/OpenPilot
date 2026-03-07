/**
 * Google Gemini Provider
 * Implementation of ModelProvider for Google Generative AI (Gemini) models.
 *
 * Pi Agent Runtime alignment: multi-model support including Google Gemini.
 *
 * NOTE: This provider uses the @google/generative-ai SDK. Install it with:
 *   npm install @google/generative-ai
 * The SDK is listed as an optional peer dependency — the provider gracefully
 * errors if the package is not installed.
 */

import { ModelProvider } from './ModelProvider';
import { Message, AIResponse, Tool, ToolCall } from '../types';

// Lazy-load the SDK so the rest of the app works even without it installed
let GoogleGenerativeAI: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  GoogleGenerativeAI = require('@google/generative-ai').GoogleGenerativeAI;
} catch {
  // SDK not installed — will throw at construction time
  GoogleGenerativeAI = null;
}

/**
 * Google Gemini provider implementation
 * Supports models like gemini-1.5-pro and gemini-1.5-flash
 */
export class GeminiProvider extends ModelProvider {
  private client: any;
  private generativeModel: any;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor(apiKey: string, model: string, maxTokens: number = 4000, temperature: number = 0.7) {
    super();
    if (!GoogleGenerativeAI) {
      throw new Error(
        'Google Generative AI SDK is not installed. Run: npm install @google/generative-ai',
      );
    }
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = model;
    this.maxTokens = maxTokens;
    this.temperature = temperature;
    this.generativeModel = this.client.getGenerativeModel({
      model: this.model,
      generationConfig: {
        maxOutputTokens: this.maxTokens,
        temperature: this.temperature,
      },
    });
  }

  /**
   * Call Gemini API with messages and optional tools
   */
  async call(messages: Message[], tools?: Tool[]): Promise<AIResponse> {
    try {
      const { systemInstruction, contents } = this.convertMessages(messages);
      const geminiTools = tools && tools.length > 0 ? this.convertTools(tools) : undefined;

      const model = geminiTools
        ? this.client.getGenerativeModel({
            model: this.model,
            generationConfig: { maxOutputTokens: this.maxTokens, temperature: this.temperature },
            systemInstruction,
            tools: geminiTools,
          })
        : this.client.getGenerativeModel({
            model: this.model,
            generationConfig: { maxOutputTokens: this.maxTokens, temperature: this.temperature },
            systemInstruction,
          });

      const result = await model.generateContent({ contents });
      return this.convertResponse(result);
    } catch (error: any) {
      this.handleError(error);
    }
  }

  /**
   * Stream Gemini API response
   */
  async *stream(messages: Message[], tools?: Tool[]): AsyncGenerator<AIResponse> {
    try {
      const { systemInstruction, contents } = this.convertMessages(messages);
      const geminiTools = tools && tools.length > 0 ? this.convertTools(tools) : undefined;

      const model = geminiTools
        ? this.client.getGenerativeModel({
            model: this.model,
            generationConfig: { maxOutputTokens: this.maxTokens, temperature: this.temperature },
            systemInstruction,
            tools: geminiTools,
          })
        : this.client.getGenerativeModel({
            model: this.model,
            generationConfig: { maxOutputTokens: this.maxTokens, temperature: this.temperature },
            systemInstruction,
          });

      const result = await model.generateContentStream({ contents });

      let totalText = '';
      for await (const chunk of result.stream) {
        const text = chunk.text?.() ?? '';
        if (text) {
          totalText += text;
          yield {
            text,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          };
        }
      }

      // Get final aggregated response for usage and tool calls
      const aggregated = await result.response;
      const usage = this.extractUsage(aggregated);
      const toolCalls = this.extractToolCalls(aggregated);

      yield {
        text: '',
        usage,
        toolCalls,
      };
    } catch (error: any) {
      this.handleError(error);
    }
  }

  /**
   * Convert internal messages to Gemini format.
   * Gemini uses a separate systemInstruction and a contents array with
   * roles 'user' and 'model'.
   */
  private convertMessages(messages: Message[]): { systemInstruction: string | undefined; contents: any[] } {
    const systemParts = messages
      .filter(m => m.role === 'system')
      .map(m => m.content);
    const systemInstruction = systemParts.length > 0 ? systemParts.join('\n\n') : undefined;

    const contents: any[] = [];
    for (const msg of messages) {
      if (msg.role === 'system') continue;
      const role = msg.role === 'assistant' ? 'model' : 'user';
      const parts: any[] = [];

      if (msg.content) {
        parts.push({ text: msg.content });
      }

      // Tool calls from assistant → functionCall parts
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          parts.push({
            functionCall: { name: tc.name, args: tc.arguments },
          });
        }
      }

      // Tool results → functionResponse parts
      if (msg.toolResults && msg.toolResults.length > 0) {
        for (const tr of msg.toolResults) {
          // Gemini expects the function name, not the call ID.
          // We look up the matching tool call from the previous assistant message
          // to get the function name. Fall back to tr.id if not found.
          let functionName = tr.id;
          // Search backward for the assistant message that issued this tool call
          const msgIdx = messages.indexOf(msg);
          for (let i = msgIdx - 1; i >= 0; i--) {
            const prev = messages[i];
            if (prev.role === 'assistant' && prev.toolCalls) {
              const matchingCall = prev.toolCalls.find(tc => tc.id === tr.id);
              if (matchingCall) {
                functionName = matchingCall.name;
                break;
              }
            }
          }
          parts.push({
            functionResponse: {
              name: functionName,
              response: tr.error ? { error: tr.error } : { result: tr.result },
            },
          });
        }
      }

      if (parts.length > 0) {
        contents.push({ role, parts });
      }
    }

    return { systemInstruction, contents };
  }

  /**
   * Convert internal Tool format to Gemini function declarations
   */
  private convertTools(tools: Tool[]): any[] {
    return [{
      functionDeclarations: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: this.cleanSchema(tool.parameters),
      })),
    }];
  }

  /**
   * Clean JSON Schema for Gemini compatibility.
   * Gemini only supports: type, properties, required, description, enum, items, format.
   * Strips unsupported fields like additionalProperties, default, examples, etc.
   */
  private cleanSchema(schema: any): any {
    if (!schema || typeof schema !== 'object') return schema;
    const allowed = ['type', 'properties', 'required', 'description', 'enum', 'items', 'format', 'nullable'];
    const cleaned: any = {};
    for (const key of Object.keys(schema)) {
      if (!allowed.includes(key)) continue;
      if (key === 'properties' && typeof schema.properties === 'object') {
        cleaned.properties = {};
        for (const [pk, pv] of Object.entries(schema.properties)) {
          cleaned.properties[pk] = this.cleanSchema(pv);
        }
      } else if (key === 'items' && typeof schema.items === 'object') {
        cleaned.items = this.cleanSchema(schema.items);
      } else {
        cleaned[key] = schema[key];
      }
    }
    return cleaned;
  }

  /**
   * Convert Gemini response to internal AIResponse format
   */
  private convertResponse(result: any): AIResponse {
    const response = result.response;
    const text = response.text?.() ?? '';
    const usage = this.extractUsage(response);
    const toolCalls = this.extractToolCalls(response);

    return { text, usage, toolCalls };
  }

  private extractUsage(response: any): { promptTokens: number; completionTokens: number; totalTokens: number } {
    const meta = response.usageMetadata;
    const promptTokens = meta?.promptTokenCount ?? 0;
    const completionTokens = meta?.candidatesTokenCount ?? 0;
    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };
  }

  private extractToolCalls(response: any): ToolCall[] | undefined {
    const candidates = response.candidates;
    if (!candidates || candidates.length === 0) return undefined;

    const parts = candidates[0].content?.parts ?? [];
    const calls: ToolCall[] = [];
    for (const part of parts) {
      if (part.functionCall) {
        calls.push({
          id: `gemini-${Date.now()}-${calls.length}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args ?? {},
        });
      }
    }
    return calls.length > 0 ? calls : undefined;
  }
}
