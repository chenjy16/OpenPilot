/**
 * Unit tests for OpenAIProvider
 */

import { OpenAIProvider } from './OpenAIProvider';
import { Message, Tool, AIResponse } from '../types';
import { AuthenticationError, RateLimitError, NetworkError } from './ModelProvider';
import OpenAI from 'openai';

// Mock the OpenAI SDK
jest.mock('openai');

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;
  let mockCreate: jest.Mock;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Create mock function for chat.completions.create
    mockCreate = jest.fn();

    // Mock OpenAI constructor to return our mock client
    (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(() => {
      return {
        chat: {
          completions: {
            create: mockCreate,
          },
        },
      } as any;
    });

    // Create provider instance
    provider = new OpenAIProvider('test-api-key', 'gpt-3.5-turbo', 2000, 0.7);
  });

  describe('constructor', () => {
    it('should initialize with provided parameters', () => {
      expect(OpenAI).toHaveBeenCalledWith({ apiKey: 'test-api-key' });
      expect(provider).toBeInstanceOf(OpenAIProvider);
    });
  });

  describe('call()', () => {
    it('should call OpenAI API with correct parameters', async () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: 'Hello',
          timestamp: new Date(),
        },
      ];

      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Hi there!',
              role: 'assistant',
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      mockCreate.mockResolvedValue(mockResponse as any);

      const response = await provider.call(messages);

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 2000,
        temperature: 0.7,
      });

      expect(response.text).toBe('Hi there!');
      expect(response.usage.promptTokens).toBe(10);
      expect(response.usage.completionTokens).toBe(5);
      expect(response.usage.totalTokens).toBe(15);
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
        choices: [
          {
            message: {
              content: 'File read successfully',
              role: 'assistant',
            },
          },
        ],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 10,
          total_tokens: 30,
        },
      };

      mockCreate.mockResolvedValue(mockResponse as any);

      await provider.call(messages);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'readFile',
                    arguments: JSON.stringify({ path: 'test.txt' }),
                  },
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
        choices: [
          {
            message: {
              content: '',
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_456',
                  type: 'function',
                  function: {
                    name: 'readFile',
                    arguments: JSON.stringify({ path: 'test.txt' }),
                  },
                },
              ],
            },
          },
        ],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 20,
          total_tokens: 70,
        },
      };

      mockCreate.mockResolvedValue(mockResponse as any);

      const response = await provider.call(messages, tools);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            {
              type: 'function',
              function: {
                name: 'readFile',
                description: 'Read file contents',
                parameters: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                  },
                  required: ['path'],
                },
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

    it('should handle response with empty content', async () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: 'Test',
          timestamp: new Date(),
        },
      ];

      const mockResponse = {
        choices: [
          {
            message: {
              content: null,
              role: 'assistant',
            },
          },
        ],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 0,
          total_tokens: 5,
        },
      };

      mockCreate.mockResolvedValue(mockResponse as any);

      const response = await provider.call(messages);

      expect(response.text).toBe('');
    });

    it('should handle response with missing usage data', async () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: 'Test',
          timestamp: new Date(),
        },
      ];

      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Response',
              role: 'assistant',
            },
          },
        ],
        usage: undefined,
      };

      mockCreate.mockResolvedValue(mockResponse as any);

      const response = await provider.call(messages);

      expect(response.usage.promptTokens).toBe(0);
      expect(response.usage.completionTokens).toBe(0);
      expect(response.usage.totalTokens).toBe(0);
    });

    it('should handle authentication errors', async () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: 'Test',
          timestamp: new Date(),
        },
      ];

      const error = { status: 401, message: 'Invalid API key' };
      mockCreate.mockRejectedValue(error);

      await expect(provider.call(messages)).rejects.toThrow(AuthenticationError);
    });

    it('should handle rate limit errors', async () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: 'Test',
          timestamp: new Date(),
        },
      ];

      const error = { status: 429, message: 'Rate limit exceeded' };
      mockCreate.mockRejectedValue(error);

      await expect(provider.call(messages)).rejects.toThrow(RateLimitError);
    });

    it('should handle network errors', async () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: 'Test',
          timestamp: new Date(),
        },
      ];

      const error = { code: 'ECONNREFUSED', message: 'Connection refused' };
      mockCreate.mockRejectedValue(error);

      await expect(provider.call(messages)).rejects.toThrow(NetworkError);
    });

    it('should handle multiple tool calls in response', async () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: 'Read two files',
          timestamp: new Date(),
        },
      ];

      const mockResponse = {
        choices: [
          {
            message: {
              content: '',
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'readFile',
                    arguments: JSON.stringify({ path: 'file1.txt' }),
                  },
                },
                {
                  id: 'call_2',
                  type: 'function',
                  function: {
                    name: 'readFile',
                    arguments: JSON.stringify({ path: 'file2.txt' }),
                  },
                },
              ],
            },
          },
        ],
        usage: {
          prompt_tokens: 30,
          completion_tokens: 40,
          total_tokens: 70,
        },
      };

      mockCreate.mockResolvedValue(mockResponse as any);

      const response = await provider.call(messages);

      expect(response.toolCalls).toHaveLength(2);
      expect(response.toolCalls![0].id).toBe('call_1');
      expect(response.toolCalls![1].id).toBe('call_2');
    });
  });
});
