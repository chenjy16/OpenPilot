/**
 * Unit tests for AnthropicProvider
 */

import { AnthropicProvider } from './AnthropicProvider';
import { Message, Tool } from '../types';
import { AuthenticationError, RateLimitError, NetworkError } from './ModelProvider';
import Anthropic from '@anthropic-ai/sdk';

// Mock the Anthropic SDK
jest.mock('@anthropic-ai/sdk');

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;
  let mockCreate: jest.Mock;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Create mock function for messages.create
    mockCreate = jest.fn();

    // Mock Anthropic constructor to return our mock client
    (Anthropic as jest.MockedClass<typeof Anthropic>).mockImplementation(() => {
      return {
        messages: {
          create: mockCreate,
        },
      } as any;
    });

    // Create provider instance
    provider = new AnthropicProvider('test-api-key', 'claude-2', 4000, 0.5);
  });

  describe('constructor', () => {
    it('should initialize with provided parameters', () => {
      expect(Anthropic).toHaveBeenCalledWith({ apiKey: 'test-api-key' });
      expect(provider).toBeInstanceOf(AnthropicProvider);
    });
  });

  describe('call()', () => {
    it('should call Anthropic API with correct parameters', async () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: 'Hello',
          timestamp: new Date(),
        },
      ];

      const mockResponse = {
        content: [{ type: 'text', text: 'Hi there!' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      };

      mockCreate.mockResolvedValue(mockResponse as any);

      const response = await provider.call(messages);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-2',
          max_tokens: 4000,
          temperature: 0.5,
        })
      );

      expect(response.text).toBe('Hi there!');
      expect(response.usage.promptTokens).toBe(10);
      expect(response.usage.completionTokens).toBe(5);
      expect(response.usage.totalTokens).toBe(15);
    });

    it('should handle system messages separately', async () => {
      const messages: Message[] = [
        {
          role: 'system',
          content: 'You are a helpful assistant',
          timestamp: new Date(),
        },
        {
          role: 'user',
          content: 'Hello',
          timestamp: new Date(),
        },
      ];

      const mockResponse = {
        content: [{ type: 'text', text: 'Hi!' }],
        usage: { input_tokens: 20, output_tokens: 3 },
      };

      mockCreate.mockResolvedValue(mockResponse as any);

      await provider.call(messages);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'You are a helpful assistant',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
        })
      );
    });

    it('should handle multiple system messages', async () => {
      const messages: Message[] = [
        {
          role: 'system',
          content: 'First instruction',
          timestamp: new Date(),
        },
        {
          role: 'system',
          content: 'Second instruction',
          timestamp: new Date(),
        },
        {
          role: 'user',
          content: 'Hello',
          timestamp: new Date(),
        },
      ];

      const mockResponse = {
        content: [{ type: 'text', text: 'Hi!' }],
        usage: { input_tokens: 30, output_tokens: 3 },
      };

      mockCreate.mockResolvedValue(mockResponse as any);

      await provider.call(messages);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'First instruction\n\nSecond instruction',
        })
      );
    });

    it('should handle messages with tool calls', async () => {
      const messages: Message[] = [
        {
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          toolCalls: [
            {
              id: 'call_123',
              name: 'readFile',
              arguments: { path: 'test.txt' },
            },
          ],
        },
      ];

      const mockResponse = {
        content: [{ type: 'text', text: 'File read successfully' }],
        usage: { input_tokens: 20, output_tokens: 10 },
      };

      mockCreate.mockResolvedValue(mockResponse as any);

      await provider.call(messages);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: 'call_123',
                  name: 'readFile',
                  input: { path: 'test.txt' },
                },
              ],
            },
          ],
        })
      );
    });

    it('should handle messages with tool results', async () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: '',
          timestamp: new Date(),
          toolResults: [
            {
              id: 'call_123',
              result: 'file content',
            },
          ],
        },
      ];

      const mockResponse = {
        content: [{ type: 'text', text: 'The file contains: file content' }],
        usage: { input_tokens: 25, output_tokens: 15 },
      };

      mockCreate.mockResolvedValue(mockResponse as any);

      await provider.call(messages);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'call_123',
                  content: '"file content"',
                },
              ],
            },
          ],
        })
      );
    });

    it('should handle tool results with errors', async () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: '',
          timestamp: new Date(),
          toolResults: [
            {
              id: 'call_123',
              error: 'File not found',
            },
          ],
        },
      ];

      const mockResponse = {
        content: [{ type: 'text', text: 'I encountered an error' }],
        usage: { input_tokens: 20, output_tokens: 10 },
      };

      mockCreate.mockResolvedValue(mockResponse as any);

      await provider.call(messages);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'call_123',
                  content: 'Error: File not found',
                },
              ],
            },
          ],
        })
      );
    });

    it('should include tools in request when provided', async () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: 'Read a file',
          timestamp: new Date(),
        },
      ];

      const tools: Tool[] = [
        {
          name: 'readFile',
          description: 'Read file contents',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
            },
            required: ['path'],
          },
          execute: async () => 'file content',
        },
      ];

      const mockResponse = {
        content: [
          {
            type: 'tool_use',
            id: 'call_456',
            name: 'readFile',
            input: { path: 'test.txt' },
          },
        ],
        usage: { input_tokens: 50, output_tokens: 20 },
      };

      mockCreate.mockResolvedValue(mockResponse as any);

      const response = await provider.call(messages, tools);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            {
              name: 'readFile',
              description: 'Read file contents',
              input_schema: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                },
                required: ['path'],
              },
            },
          ],
        })
      );

      expect(response.toolCalls).toBeDefined();
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].id).toBe('call_456');
      expect(response.toolCalls![0].name).toBe('readFile');
      expect(response.toolCalls![0].arguments).toEqual({ path: 'test.txt' });
    });

    it('should handle response with mixed content blocks', async () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: 'Test',
          timestamp: new Date(),
        },
      ];

      const mockResponse = {
        content: [
          { type: 'text', text: 'Let me help you with that. ' },
          {
            type: 'tool_use',
            id: 'call_789',
            name: 'searchWeb',
            input: { query: 'test query' },
          },
        ],
        usage: { input_tokens: 15, output_tokens: 25 },
      };

      mockCreate.mockResolvedValue(mockResponse as any);

      const response = await provider.call(messages);

      expect(response.text).toBe('Let me help you with that. ');
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].id).toBe('call_789');
    });

    it('should handle authentication errors', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Test', timestamp: new Date() }];
      const error = { status: 401, message: 'Invalid API key' };
      mockCreate.mockRejectedValue(error);
      await expect(provider.call(messages)).rejects.toThrow(AuthenticationError);
    });

    it('should handle rate limit errors', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Test', timestamp: new Date() }];
      const error = { status: 429, message: 'Rate limit exceeded' };
      mockCreate.mockRejectedValue(error);
      await expect(provider.call(messages)).rejects.toThrow(RateLimitError);
    });

    it('should handle network errors', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Test', timestamp: new Date() }];
      const error = { code: 'ECONNREFUSED', message: 'Connection refused' };
      mockCreate.mockRejectedValue(error);
      await expect(provider.call(messages)).rejects.toThrow(NetworkError);
    });

    it('should handle multiple tool calls in response', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Read two files', timestamp: new Date() }];

      const mockResponse = {
        content: [
          { type: 'tool_use', id: 'call_1', name: 'readFile', input: { path: 'file1.txt' } },
          { type: 'tool_use', id: 'call_2', name: 'readFile', input: { path: 'file2.txt' } },
        ],
        usage: { input_tokens: 30, output_tokens: 40 },
      };

      mockCreate.mockResolvedValue(mockResponse as any);

      const response = await provider.call(messages);

      expect(response.toolCalls).toHaveLength(2);
      expect(response.toolCalls![0].id).toBe('call_1');
      expect(response.toolCalls![1].id).toBe('call_2');
    });

    it('should handle empty text content', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Test', timestamp: new Date() }];

      const mockResponse = {
        content: [{ type: 'tool_use', id: 'call_1', name: 'test', input: {} }],
        usage: { input_tokens: 10, output_tokens: 5 },
      };

      mockCreate.mockResolvedValue(mockResponse as any);

      const response = await provider.call(messages);

      expect(response.text).toBe('');
      expect(response.toolCalls).toHaveLength(1);
    });
  });
});
