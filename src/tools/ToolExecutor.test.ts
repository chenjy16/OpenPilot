/**
 * Unit tests for ToolExecutor
 */

import { ToolExecutor } from './ToolExecutor';
import { Tool, ValidationError } from '../types';

describe('ToolExecutor', () => {
  let executor: ToolExecutor;

  beforeEach(() => {
    executor = new ToolExecutor();
  });

  describe('register()', () => {
    it('should register a valid tool', () => {
      const tool: Tool = {
        name: 'testTool',
        description: 'A test tool',
        parameters: {
          type: 'object',
          properties: {
            input: { type: 'string' }
          },
          required: ['input']
        },
        execute: async (params: any) => params
      };

      expect(() => executor.register(tool)).not.toThrow();
      expect(executor.hasTool('testTool')).toBe(true);
    });

    it('should throw ValidationError for empty tool name', () => {
      const tool: Tool = {
        name: '',
        description: 'A test tool',
        parameters: { type: 'object', properties: {} },
        execute: async (params: any) => params
      };

      expect(() => executor.register(tool)).toThrow(ValidationError);
      expect(() => executor.register(tool)).toThrow('Tool name must be a non-empty string');
    });

    it('should throw ValidationError for missing tool name', () => {
      const tool: any = {
        description: 'A test tool',
        parameters: { type: 'object', properties: {} },
        execute: async (params: any) => params
      };

      expect(() => executor.register(tool)).toThrow(ValidationError);
    });

    it('should throw ValidationError for missing description', () => {
      const tool: any = {
        name: 'testTool',
        parameters: { type: 'object', properties: {} },
        execute: async (params: any) => params
      };

      expect(() => executor.register(tool)).toThrow(ValidationError);
      expect(() => executor.register(tool)).toThrow('Tool description must be a non-empty string');
    });

    it('should throw ValidationError for missing parameters', () => {
      const tool: any = {
        name: 'testTool',
        description: 'A test tool',
        execute: async (params: any) => params
      };

      expect(() => executor.register(tool)).toThrow(ValidationError);
      expect(() => executor.register(tool)).toThrow('Tool parameters must be defined');
    });

    it('should throw ValidationError for missing execute function', () => {
      const tool: any = {
        name: 'testTool',
        description: 'A test tool',
        parameters: { type: 'object', properties: {} }
      };

      expect(() => executor.register(tool)).toThrow(ValidationError);
      expect(() => executor.register(tool)).toThrow('Tool execute must be a function');
    });

    it('should throw ValidationError for duplicate tool name', () => {
      const tool1: Tool = {
        name: 'duplicateTool',
        description: 'First tool',
        parameters: { type: 'object', properties: {} },
        execute: async (params: any) => params
      };

      const tool2: Tool = {
        name: 'duplicateTool',
        description: 'Second tool',
        parameters: { type: 'object', properties: {} },
        execute: async (params: any) => params
      };

      executor.register(tool1);
      expect(() => executor.register(tool2)).toThrow(ValidationError);
      expect(() => executor.register(tool2)).toThrow("Tool 'duplicateTool' is already registered");
    });

    it('should allow registering multiple different tools', () => {
      const tool1: Tool = {
        name: 'tool1',
        description: 'First tool',
        parameters: { type: 'object', properties: {} },
        execute: async (params: any) => params
      };

      const tool2: Tool = {
        name: 'tool2',
        description: 'Second tool',
        parameters: { type: 'object', properties: {} },
        execute: async (params: any) => params
      };

      executor.register(tool1);
      executor.register(tool2);

      expect(executor.hasTool('tool1')).toBe(true);
      expect(executor.hasTool('tool2')).toBe(true);
    });
  });

  describe('getTool()', () => {
    it('should return registered tool by name', () => {
      const tool: Tool = {
        name: 'myTool',
        description: 'My test tool',
        parameters: { type: 'object', properties: {} },
        execute: async (params: any) => params
      };

      executor.register(tool);
      const retrieved = executor.getTool('myTool');

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('myTool');
      expect(retrieved?.description).toBe('My test tool');
    });

    it('should return undefined for unregistered tool', () => {
      const retrieved = executor.getTool('nonexistent');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('hasTool()', () => {
    it('should return true for registered tool', () => {
      const tool: Tool = {
        name: 'existingTool',
        description: 'An existing tool',
        parameters: { type: 'object', properties: {} },
        execute: async (params: any) => params
      };

      executor.register(tool);
      expect(executor.hasTool('existingTool')).toBe(true);
    });

    it('should return false for unregistered tool', () => {
      expect(executor.hasTool('nonexistent')).toBe(false);
    });
  });

  describe('getRegisteredToolNames()', () => {
    it('should return empty array when no tools registered', () => {
      expect(executor.getRegisteredToolNames()).toEqual([]);
    });

    it('should return all registered tool names', () => {
      const tool1: Tool = {
        name: 'tool1',
        description: 'First tool',
        parameters: { type: 'object', properties: {} },
        execute: async (params: any) => params
      };

      const tool2: Tool = {
        name: 'tool2',
        description: 'Second tool',
        parameters: { type: 'object', properties: {} },
        execute: async (params: any) => params
      };

      executor.register(tool1);
      executor.register(tool2);

      const names = executor.getRegisteredToolNames();
      expect(names).toHaveLength(2);
      expect(names).toContain('tool1');
      expect(names).toContain('tool2');
    });
  });

  describe('execute()', () => {
    it('should throw ValidationError for unregistered tool', async () => {
      const toolCalls = [
        {
          id: 'call-1',
          name: 'unregisteredTool',
          arguments: {}
        }
      ];

      await expect(executor.execute(toolCalls)).rejects.toThrow(ValidationError);
      await expect(executor.execute(toolCalls)).rejects.toThrow("Tool 'unregisteredTool' is not registered");
    });

    it('should validate all tools before execution', async () => {
      const tool: Tool = {
        name: 'registeredTool',
        description: 'A registered tool',
        parameters: { type: 'object', properties: {} },
        execute: async (params: any) => params
      };

      executor.register(tool);

      const toolCalls = [
        {
          id: 'call-1',
          name: 'registeredTool',
          arguments: {}
        },
        {
          id: 'call-2',
          name: 'unregisteredTool',
          arguments: {}
        }
      ];

      await expect(executor.execute(toolCalls)).rejects.toThrow(ValidationError);
      await expect(executor.execute(toolCalls)).rejects.toThrow("Tool 'unregisteredTool' is not registered");
    });

    it('should execute a single tool successfully', async () => {
      const tool: Tool = {
        name: 'echoTool',
        description: 'Echoes input',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string' }
          },
          required: ['message']
        },
        execute: async (params: any) => `Echo: ${params.message}`
      };

      executor.register(tool);

      const toolCalls = [
        {
          id: 'call-1',
          name: 'echoTool',
          arguments: { message: 'Hello' }
        }
      ];

      const results = await executor.execute(toolCalls);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('call-1');
      expect(results[0].result).toBe('Echo: Hello');
      expect(results[0].error).toBeUndefined();
    });

    it('should execute multiple tools in parallel', async () => {
      const tool1: Tool = {
        name: 'addTool',
        description: 'Adds two numbers',
        parameters: {
          type: 'object',
          properties: {
            a: { type: 'number' },
            b: { type: 'number' }
          },
          required: ['a', 'b']
        },
        execute: async (params: any) => params.a + params.b
      };

      const tool2: Tool = {
        name: 'multiplyTool',
        description: 'Multiplies two numbers',
        parameters: {
          type: 'object',
          properties: {
            a: { type: 'number' },
            b: { type: 'number' }
          },
          required: ['a', 'b']
        },
        execute: async (params: any) => params.a * params.b
      };

      executor.register(tool1);
      executor.register(tool2);

      const toolCalls = [
        {
          id: 'call-1',
          name: 'addTool',
          arguments: { a: 5, b: 3 }
        },
        {
          id: 'call-2',
          name: 'multiplyTool',
          arguments: { a: 4, b: 7 }
        }
      ];

      const results = await executor.execute(toolCalls);

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('call-1');
      expect(results[0].result).toBe(8);
      expect(results[1].id).toBe('call-2');
      expect(results[1].result).toBe(28);
    });

    it('should handle tool execution failure with error', async () => {
      const tool: Tool = {
        name: 'failingTool',
        description: 'A tool that fails',
        parameters: {
          type: 'object',
          properties: {}
        },
        execute: async () => {
          throw new Error('Tool execution failed');
        }
      };

      executor.register(tool);

      const toolCalls = [
        {
          id: 'call-1',
          name: 'failingTool',
          arguments: {}
        }
      ];

      const results = await executor.execute(toolCalls);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('call-1');
      expect(results[0].result).toBeUndefined();
      expect(results[0].error).toBe('Tool execution failed');
    });

    it('should handle mixed success and failure', async () => {
      const successTool: Tool = {
        name: 'successTool',
        description: 'A successful tool',
        parameters: {
          type: 'object',
          properties: {}
        },
        execute: async () => 'success'
      };

      const failTool: Tool = {
        name: 'failTool',
        description: 'A failing tool',
        parameters: {
          type: 'object',
          properties: {}
        },
        execute: async () => {
          throw new Error('failure');
        }
      };

      executor.register(successTool);
      executor.register(failTool);

      const toolCalls = [
        {
          id: 'call-1',
          name: 'successTool',
          arguments: {}
        },
        {
          id: 'call-2',
          name: 'failTool',
          arguments: {}
        }
      ];

      const results = await executor.execute(toolCalls);

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('call-1');
      expect(results[0].result).toBe('success');
      expect(results[0].error).toBeUndefined();
      expect(results[1].id).toBe('call-2');
      expect(results[1].result).toBeUndefined();
      expect(results[1].error).toBe('failure');
    });

    it('should validate required parameters', async () => {
      const tool: Tool = {
        name: 'paramTool',
        description: 'A tool with required params',
        parameters: {
          type: 'object',
          properties: {
            required1: { type: 'string' },
            required2: { type: 'number' }
          },
          required: ['required1', 'required2']
        },
        execute: async (params: any) => params
      };

      executor.register(tool);

      const toolCalls = [
        {
          id: 'call-1',
          name: 'paramTool',
          arguments: { required1: 'value' } // missing required2
        }
      ];

      const results = await executor.execute(toolCalls);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('call-1');
      expect(results[0].result).toBeUndefined();
      expect(results[0].error).toContain('Missing required parameter: required2');
    });

    it('should validate unknown parameters', async () => {
      const tool: Tool = {
        name: 'strictTool',
        description: 'A tool with strict params',
        parameters: {
          type: 'object',
          properties: {
            allowed: { type: 'string' }
          }
        },
        execute: async (params: any) => params
      };

      executor.register(tool);

      const toolCalls = [
        {
          id: 'call-1',
          name: 'strictTool',
          arguments: { allowed: 'value', unknown: 'bad' }
        }
      ];

      const results = await executor.execute(toolCalls);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('call-1');
      expect(results[0].result).toBeUndefined();
      expect(results[0].error).toContain('Unknown parameter: unknown');
    });

    it('should timeout after 30 seconds', async () => {
      const tool: Tool = {
        name: 'slowTool',
        description: 'A slow tool',
        parameters: {
          type: 'object',
          properties: {}
        },
        execute: async () => {
          // Simulate a long-running operation
          await new Promise(resolve => setTimeout(resolve, 35000));
          return 'done';
        }
      };

      executor.register(tool);

      const toolCalls = [
        {
          id: 'call-1',
          name: 'slowTool',
          arguments: {}
        }
      ];

      const results = await executor.execute(toolCalls);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('call-1');
      expect(results[0].result).toBeUndefined();
      expect(results[0].error).toContain('Tool execution timeout after 30000ms');
    }, 35000); // Set test timeout to 35 seconds

    it('should ensure result count equals call count', async () => {
      const tool: Tool = {
        name: 'countTool',
        description: 'A counting tool',
        parameters: {
          type: 'object',
          properties: {}
        },
        execute: async () => 'result'
      };

      executor.register(tool);

      const toolCalls = [
        { id: 'call-1', name: 'countTool', arguments: {} },
        { id: 'call-2', name: 'countTool', arguments: {} },
        { id: 'call-3', name: 'countTool', arguments: {} }
      ];

      const results = await executor.execute(toolCalls);

      expect(results.length).toBe(toolCalls.length);
    });

    it('should ensure each result ID matches a call ID', async () => {
      const tool: Tool = {
        name: 'idTool',
        description: 'An ID tool',
        parameters: {
          type: 'object',
          properties: {}
        },
        execute: async () => 'result'
      };

      executor.register(tool);

      const toolCalls = [
        { id: 'unique-1', name: 'idTool', arguments: {} },
        { id: 'unique-2', name: 'idTool', arguments: {} },
        { id: 'unique-3', name: 'idTool', arguments: {} }
      ];

      const results = await executor.execute(toolCalls);

      const callIds = new Set(toolCalls.map(tc => tc.id));
      results.forEach(result => {
        expect(callIds.has(result.id)).toBe(true);
      });
    });
  });
});
