/**
 * Sample Network Tools
 * Provides httpRequest tool for the AI assistant
 *
 * Validates: Requirements 4.1, 12.1
 */

import { Tool } from '../types';
import { ToolExecutor } from './ToolExecutor';

/**
 * Response object returned by the httpRequest tool
 */
interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Make an HTTP request using the global fetch API (Node 18+)
 * with a 30-second timeout.
 */
async function makeHttpRequest(
  url: string,
  method: string,
  headers?: Record<string, string>,
  body?: string
): Promise<HttpResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? body : undefined,
      signal: controller.signal
    });

    const responseBody = await response.text();

    // Collect response headers into a plain object
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      status: response.status,
      headers: responseHeaders,
      body: responseBody
    };
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error('Request timed out after 30 seconds');
    }
    throw new Error(`Network request failed: ${(error as Error).message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Tool that makes HTTP requests given url, method, optional headers, and optional body
 */
export const httpRequestTool: Tool = {
  name: 'httpRequest',
  description: 'Make an HTTP request to a URL and return the response status, headers, and body',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to send the request to'
      },
      method: {
        type: 'string',
        enum: ['GET', 'POST', 'PUT', 'DELETE'],
        description: 'The HTTP method to use (default: GET)'
      },
      headers: {
        type: 'object',
        description: 'Optional HTTP headers to include in the request',
        additionalProperties: { type: 'string' }
      },
      body: {
        type: 'string',
        description: 'Optional request body (for POST/PUT requests)'
      }
    },
    required: ['url']
  },
  execute: async (params: Record<string, unknown>): Promise<HttpResponse> => {
    const url = params.url as string;
    const method = (params.method as string | undefined) ?? 'GET';
    const headers = params.headers as Record<string, string> | undefined;
    const body = params.body as string | undefined;

    // Validate method
    const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE'];
    if (!allowedMethods.includes(method.toUpperCase())) {
      throw new Error(`Invalid HTTP method: ${method}. Must be one of: ${allowedMethods.join(', ')}`);
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }

    return makeHttpRequest(url, method.toUpperCase(), headers, body);
  }
};

/**
 * Register network tools with the given ToolExecutor
 *
 * @param executor - The ToolExecutor to register tools with
 */
export function registerNetworkTools(executor: ToolExecutor): void {
  executor.register(httpRequestTool);
}
