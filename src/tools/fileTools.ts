/**
 * Sample File Tools
 * Provides readFile and writeFile tools for the AI assistant
 *
 * Validates: Requirements 4.1, 12.1
 */

import { promises as fs } from 'fs';
import { Tool } from '../types';
import { ToolExecutor } from './ToolExecutor';

/**
 * Tool that reads a file from disk given a path parameter
 */
export const readFileTool: Tool = {
  name: 'readFile',
  description: 'Read the contents of a file from disk',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path to the file to read'
      }
    },
    required: ['path']
  },
  execute: async (params: Record<string, unknown>): Promise<string> => {
    const filePath = params.path as string;
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`File not found: ${filePath}`);
      }
      if ((error as NodeJS.ErrnoException).code === 'EACCES') {
        throw new Error(`Permission denied: ${filePath}`);
      }
      throw new Error(`Failed to read file: ${(error as Error).message}`);
    }
  }
};

/**
 * Tool that writes content to a file given path and content parameters
 */
export const writeFileTool: Tool = {
  name: 'writeFile',
  description: 'Write content to a file on disk',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path to the file to write'
      },
      content: {
        type: 'string',
        description: 'The content to write to the file'
      }
    },
    required: ['path', 'content']
  },
  execute: async (params: Record<string, unknown>): Promise<string> => {
    const filePath = params.path as string;
    const content = params.content as string;
    try {
      await fs.writeFile(filePath, content, 'utf-8');
      return `File written successfully: ${filePath}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EACCES') {
        throw new Error(`Permission denied: ${filePath}`);
      }
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Directory not found for path: ${filePath}`);
      }
      throw new Error(`Failed to write file: ${(error as Error).message}`);
    }
  }
};

/**
 * Register both file tools with the given ToolExecutor
 *
 * @param executor - The ToolExecutor to register tools with
 */
export function registerFileTools(executor: ToolExecutor): void {
  executor.register(readFileTool);
  executor.register(writeFileTool);
}
