/**
 * Model Provider
 * Abstract base class for AI model providers
 */

import { Message, AIResponse, Tool } from '../types';

/**
 * Custom error types for model provider operations
 */
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class RateLimitError extends Error {
  public retryAfter?: number;

  constructor(message: string, retryAfter?: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class ContextOverflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextOverflowError';
  }
}

/**
 * Abstract base class for AI model providers
 * Provides common error handling and defines the interface for model calls
 */
export abstract class ModelProvider {
  /**
   * Call the AI model with messages and optional tools
   * @param messages - Array of conversation messages
   * @param tools - Optional array of tools available to the model
   * @returns Promise resolving to AIResponse
   * @throws {AuthenticationError} if API key is invalid
   * @throws {RateLimitError} if rate limit is exceeded
   * @throws {NetworkError} if network connection fails
   * @throws {ContextOverflowError} if context length is exceeded
   */
  abstract call(messages: Message[], tools?: Tool[]): Promise<AIResponse>;

  /**
   * Stream the AI model response with messages and optional tools
   * @param messages - Array of conversation messages
   * @param tools - Optional array of tools available to the model
   * @yields AIResponse chunks with incremental text
   * @throws {AuthenticationError} if API key is invalid
   * @throws {RateLimitError} if rate limit is exceeded
   * @throws {NetworkError} if network connection fails
   * @throws {ContextOverflowError} if context length is exceeded
   */
  abstract stream(messages: Message[], tools?: Tool[]): AsyncGenerator<AIResponse>;

  /**
   * Handle authentication errors
   * @param error - The original error
   * @throws {AuthenticationError} with user-friendly message
   */
  protected handleAuthError(error: any): never {
    throw new AuthenticationError(
      'Authentication failed. Please check your API key configuration.'
    );
  }

  /**
   * Handle rate limit errors
   * @param error - The original error
   * @param retryAfter - Optional retry-after time in seconds
   * @throws {RateLimitError} with retry information
   */
  protected handleRateLimitError(error: any, retryAfter?: number): never {
    throw new RateLimitError(
      'Rate limit exceeded. Please wait before retrying.',
      retryAfter
    );
  }

  /**
   * Handle network errors
   * @param error - The original error
   * @throws {NetworkError} with user-friendly message
   */
  protected handleNetworkError(error: any): never {
    throw new NetworkError(
      'Network connection failed. Please check your internet connection and try again.'
    );
  }

  /**
   * Handle context overflow errors
   * @param error - The original error
   * @throws {ContextOverflowError} with user-friendly message
   */
  protected handleContextOverflowError(error: any): never {
    throw new ContextOverflowError(
      'Context length exceeded. The conversation is too long for the model.'
    );
  }

  /**
   * Determine error type and handle appropriately
   * @param error - The error to handle
   * @throws Appropriate error type based on the error
   */
  protected handleError(error: any): never {
    // Check for authentication errors (401, 403)
    if (error.status === 401 || error.status === 403 || error.code === 'invalid_api_key') {
      this.handleAuthError(error);
    }

    // Check for rate limit errors (429)
    if (error.status === 429 || error.code === 'rate_limit_exceeded') {
      const retryAfter = error.headers?.['retry-after'] 
        ? parseInt(error.headers['retry-after'], 10) 
        : undefined;
      this.handleRateLimitError(error, retryAfter);
    }

    // Check for context overflow errors
    if (
      error.code === 'context_length_exceeded' ||
      error.message?.includes('context') ||
      error.message?.includes('token limit')
    ) {
      this.handleContextOverflowError(error);
    }

    // Check for network errors
    if (
      error.code === 'ECONNREFUSED' ||
      error.code === 'ENOTFOUND' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ECONNRESET' ||
      error.message?.includes('network') ||
      error.message?.includes('fetch failed')
    ) {
      this.handleNetworkError(error);
    }

    // Default: throw the original error
    throw error;
  }
}
