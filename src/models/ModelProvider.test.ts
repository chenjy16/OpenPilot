/**
 * Unit tests for ModelProvider
 */

import {
  ModelProvider,
  AuthenticationError,
  RateLimitError,
  NetworkError,
  ContextOverflowError,
} from './ModelProvider';
import { Message, AIResponse, Tool } from '../types';

/**
 * Concrete implementation of ModelProvider for testing
 */
class TestModelProvider extends ModelProvider {
  async call(messages: Message[], tools?: Tool[]): Promise<AIResponse> {
    return {
      text: 'Test response',
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      },
    };
  }

  async *stream(messages: Message[], tools?: Tool[]): AsyncGenerator<AIResponse> {
    yield {
      text: 'Test ',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
    yield {
      text: 'response',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    };
  }

  // Expose protected methods for testing
  public testHandleAuthError(error: any): never {
    return this.handleAuthError(error);
  }

  public testHandleRateLimitError(error: any, retryAfter?: number): never {
    return this.handleRateLimitError(error, retryAfter);
  }

  public testHandleNetworkError(error: any): never {
    return this.handleNetworkError(error);
  }

  public testHandleContextOverflowError(error: any): never {
    return this.handleContextOverflowError(error);
  }

  public testHandleError(error: any): never {
    return this.handleError(error);
  }
}

describe('ModelProvider', () => {
  let provider: TestModelProvider;

  beforeEach(() => {
    provider = new TestModelProvider();
  });

  describe('call()', () => {
    it('should be implemented by subclasses', async () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: 'Hello',
          timestamp: new Date(),
        },
      ];

      const response = await provider.call(messages);
      expect(response).toBeDefined();
      expect(response.text).toBe('Test response');
      expect(response.usage.totalTokens).toBe(30);
    });
  });

  describe('handleAuthError()', () => {
    it('should throw AuthenticationError with user-friendly message', () => {
      const error = { status: 401, message: 'Invalid API key' };

      expect(() => provider.testHandleAuthError(error)).toThrow(AuthenticationError);
      expect(() => provider.testHandleAuthError(error)).toThrow(
        'Authentication failed. Please check your API key configuration.'
      );
    });

    it('should set correct error name', () => {
      const error = { status: 401 };

      try {
        provider.testHandleAuthError(error);
      } catch (e: any) {
        expect(e.name).toBe('AuthenticationError');
      }
    });
  });

  describe('handleRateLimitError()', () => {
    it('should throw RateLimitError with user-friendly message', () => {
      const error = { status: 429, message: 'Rate limit exceeded' };

      expect(() => provider.testHandleRateLimitError(error)).toThrow(RateLimitError);
      expect(() => provider.testHandleRateLimitError(error)).toThrow(
        'Rate limit exceeded. Please wait before retrying.'
      );
    });

    it('should include retryAfter time when provided', () => {
      const error = { status: 429 };
      const retryAfter = 60;

      try {
        provider.testHandleRateLimitError(error, retryAfter);
      } catch (e: any) {
        expect(e).toBeInstanceOf(RateLimitError);
        expect(e.retryAfter).toBe(60);
      }
    });

    it('should set correct error name', () => {
      const error = { status: 429 };

      try {
        provider.testHandleRateLimitError(error);
      } catch (e: any) {
        expect(e.name).toBe('RateLimitError');
      }
    });
  });

  describe('handleNetworkError()', () => {
    it('should throw NetworkError with user-friendly message', () => {
      const error = { code: 'ECONNREFUSED', message: 'Connection refused' };

      expect(() => provider.testHandleNetworkError(error)).toThrow(NetworkError);
      expect(() => provider.testHandleNetworkError(error)).toThrow(
        'Network connection failed. Please check your internet connection and try again.'
      );
    });

    it('should set correct error name', () => {
      const error = { code: 'ETIMEDOUT' };

      try {
        provider.testHandleNetworkError(error);
      } catch (e: any) {
        expect(e.name).toBe('NetworkError');
      }
    });
  });

  describe('handleContextOverflowError()', () => {
    it('should throw ContextOverflowError with user-friendly message', () => {
      const error = { code: 'context_length_exceeded', message: 'Context too long' };

      expect(() => provider.testHandleContextOverflowError(error)).toThrow(
        ContextOverflowError
      );
      expect(() => provider.testHandleContextOverflowError(error)).toThrow(
        'Context length exceeded. The conversation is too long for the model.'
      );
    });

    it('should set correct error name', () => {
      const error = { code: 'context_length_exceeded' };

      try {
        provider.testHandleContextOverflowError(error);
      } catch (e: any) {
        expect(e.name).toBe('ContextOverflowError');
      }
    });
  });

  describe('handleError()', () => {
    it('should handle 401 authentication errors', () => {
      const error = { status: 401, message: 'Unauthorized' };

      expect(() => provider.testHandleError(error)).toThrow(AuthenticationError);
    });

    it('should handle 403 authentication errors', () => {
      const error = { status: 403, message: 'Forbidden' };

      expect(() => provider.testHandleError(error)).toThrow(AuthenticationError);
    });

    it('should handle invalid_api_key code', () => {
      const error = { code: 'invalid_api_key', message: 'Invalid API key' };

      expect(() => provider.testHandleError(error)).toThrow(AuthenticationError);
    });

    it('should handle 429 rate limit errors', () => {
      const error = { status: 429, message: 'Too many requests' };

      expect(() => provider.testHandleError(error)).toThrow(RateLimitError);
    });

    it('should handle rate_limit_exceeded code', () => {
      const error = { code: 'rate_limit_exceeded', message: 'Rate limit exceeded' };

      expect(() => provider.testHandleError(error)).toThrow(RateLimitError);
    });

    it('should extract retry-after header for rate limit errors', () => {
      const error = {
        status: 429,
        headers: { 'retry-after': '120' },
      };

      try {
        provider.testHandleError(error);
      } catch (e: any) {
        expect(e).toBeInstanceOf(RateLimitError);
        expect(e.retryAfter).toBe(120);
      }
    });

    it('should handle context_length_exceeded code', () => {
      const error = { code: 'context_length_exceeded', message: 'Context too long' };

      expect(() => provider.testHandleError(error)).toThrow(ContextOverflowError);
    });

    it('should handle context-related error messages', () => {
      const error = { message: 'Maximum context length exceeded' };

      expect(() => provider.testHandleError(error)).toThrow(ContextOverflowError);
    });

    it('should handle token limit error messages', () => {
      const error = { message: 'Request exceeds token limit' };

      expect(() => provider.testHandleError(error)).toThrow(ContextOverflowError);
    });

    it('should handle ECONNREFUSED network errors', () => {
      const error = { code: 'ECONNREFUSED', message: 'Connection refused' };

      expect(() => provider.testHandleError(error)).toThrow(NetworkError);
    });

    it('should handle ENOTFOUND network errors', () => {
      const error = { code: 'ENOTFOUND', message: 'Host not found' };

      expect(() => provider.testHandleError(error)).toThrow(NetworkError);
    });

    it('should handle ETIMEDOUT network errors', () => {
      const error = { code: 'ETIMEDOUT', message: 'Connection timed out' };

      expect(() => provider.testHandleError(error)).toThrow(NetworkError);
    });

    it('should handle ECONNRESET network errors', () => {
      const error = { code: 'ECONNRESET', message: 'Connection reset' };

      expect(() => provider.testHandleError(error)).toThrow(NetworkError);
    });

    it('should handle network-related error messages', () => {
      const error = { message: 'network error occurred' };

      expect(() => provider.testHandleError(error)).toThrow(NetworkError);
    });

    it('should handle fetch failed error messages', () => {
      const error = { message: 'fetch failed' };

      expect(() => provider.testHandleError(error)).toThrow(NetworkError);
    });

    it('should throw original error for unknown error types', () => {
      const error = new Error('Unknown error');

      expect(() => provider.testHandleError(error)).toThrow(error);
    });
  });
});
