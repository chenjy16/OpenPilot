/**
 * Basic type tests to verify setup
 */

import {
  Message,
  ToolCall,
  ToolResult,
  Usage,
  Session,
  AIRequest,
  AIResponse,
  Tool,
  ModelConfig,
  ValidationError,
  validateMessage,
  validateToolCall,
  validateToolResult,
  validateUsage,
  isMessageRole
} from './index';

describe('Type definitions', () => {
  it('should define Message interface', () => {
    const message: Message = {
      role: 'user',
      content: 'Hello',
      timestamp: new Date()
    };
    expect(message.role).toBe('user');
    expect(message.content).toBe('Hello');
  });

  it('should define ToolCall interface', () => {
    const toolCall: ToolCall = {
      id: 'call-1',
      name: 'readFile',
      arguments: { path: '/test.txt' }
    };
    expect(toolCall.id).toBe('call-1');
    expect(toolCall.name).toBe('readFile');
  });

  it('should define ToolResult interface', () => {
    const toolResult: ToolResult = {
      id: 'call-1',
      result: 'file content'
    };
    expect(toolResult.id).toBe('call-1');
    expect(toolResult.result).toBe('file content');
  });

  it('should define Usage interface', () => {
    const usage: Usage = {
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30
    };
    expect(usage.totalTokens).toBe(30);
  });

  it('should define Session interface', () => {
    const session: Session = {
      id: 'session-1',
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        model: 'gpt-3.5-turbo',
        totalTokens: 0,
        cost: 0
      }
    };
    expect(session.id).toBe('session-1');
  });

  it('should define AIRequest interface', () => {
    const request: AIRequest = {
      sessionId: 'session-1',
      message: 'Hello',
      model: 'gpt-3.5-turbo'
    };
    expect(request.sessionId).toBe('session-1');
  });

  it('should define AIResponse interface', () => {
    const response: AIResponse = {
      text: 'Hello!',
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15
      }
    };
    expect(response.text).toBe('Hello!');
  });

  it('should define Tool interface', () => {
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
      execute: async (params) => params.input
    };
    expect(tool.name).toBe('testTool');
  });

  it('should define ModelConfig interface', () => {
    const config: ModelConfig = {
      provider: 'openai',
      model: 'gpt-3.5-turbo',
      apiKey: 'test-key',
      maxTokens: 2000,
      temperature: 0.7
    };
    expect(config.provider).toBe('openai');
  });
});

describe('Message validation', () => {
  it('should validate a valid user message', () => {
    const message: Message = {
      role: 'user',
      content: 'Hello',
      timestamp: new Date()
    };
    expect(() => validateMessage(message)).not.toThrow();
  });

  it('should validate a valid assistant message', () => {
    const message: Message = {
      role: 'assistant',
      content: 'Hi there!',
      timestamp: new Date()
    };
    expect(() => validateMessage(message)).not.toThrow();
  });

  it('should validate a valid system message', () => {
    const message: Message = {
      role: 'system',
      content: 'You are a helpful assistant',
      timestamp: new Date()
    };
    expect(() => validateMessage(message)).not.toThrow();
  });

  it('should reject invalid role', () => {
    const message = {
      role: 'invalid',
      content: 'Hello',
      timestamp: new Date()
    } as any;
    expect(() => validateMessage(message)).toThrow(ValidationError);
    expect(() => validateMessage(message)).toThrow(/Invalid message role/);
  });

  it('should reject empty content', () => {
    const message: Message = {
      role: 'user',
      content: '',
      timestamp: new Date()
    };
    expect(() => validateMessage(message)).toThrow(ValidationError);
    expect(() => validateMessage(message)).toThrow(/non-empty string/);
  });

  it('should reject non-string content', () => {
    const message = {
      role: 'user',
      content: null,
      timestamp: new Date()
    } as any;
    expect(() => validateMessage(message)).toThrow(ValidationError);
    expect(() => validateMessage(message)).toThrow(/non-empty string/);
  });

  it('should reject invalid timestamp', () => {
    const message = {
      role: 'user',
      content: 'Hello',
      timestamp: 'not a date'
    } as any;
    expect(() => validateMessage(message)).toThrow(ValidationError);
    expect(() => validateMessage(message)).toThrow(/valid Date object/);
  });

  it('should reject invalid Date object', () => {
    const message: Message = {
      role: 'user',
      content: 'Hello',
      timestamp: new Date('invalid')
    };
    expect(() => validateMessage(message)).toThrow(ValidationError);
    expect(() => validateMessage(message)).toThrow(/valid Date object/);
  });
});

describe('ToolCall validation', () => {
  it('should validate a valid tool call', () => {
    const toolCall: ToolCall = {
      id: 'call-123',
      name: 'readFile',
      arguments: { path: '/test.txt' }
    };
    expect(() => validateToolCall(toolCall)).not.toThrow();
  });

  it('should validate tool call with registered tools', () => {
    const toolCall: ToolCall = {
      id: 'call-123',
      name: 'readFile',
      arguments: { path: '/test.txt' }
    };
    const registeredTools = new Set(['readFile', 'writeFile']);
    expect(() => validateToolCall(toolCall, registeredTools)).not.toThrow();
  });

  it('should reject empty id', () => {
    const toolCall: ToolCall = {
      id: '',
      name: 'readFile',
      arguments: {}
    };
    expect(() => validateToolCall(toolCall)).toThrow(ValidationError);
    expect(() => validateToolCall(toolCall)).toThrow(/id must be a non-empty string/);
  });

  it('should reject non-string id', () => {
    const toolCall = {
      id: 123,
      name: 'readFile',
      arguments: {}
    } as any;
    expect(() => validateToolCall(toolCall)).toThrow(ValidationError);
  });

  it('should reject empty name', () => {
    const toolCall: ToolCall = {
      id: 'call-123',
      name: '',
      arguments: {}
    };
    expect(() => validateToolCall(toolCall)).toThrow(ValidationError);
    expect(() => validateToolCall(toolCall)).toThrow(/name must be a non-empty string/);
  });

  it('should reject unregistered tool name', () => {
    const toolCall: ToolCall = {
      id: 'call-123',
      name: 'unknownTool',
      arguments: {}
    };
    const registeredTools = new Set(['readFile', 'writeFile']);
    expect(() => validateToolCall(toolCall, registeredTools)).toThrow(ValidationError);
    expect(() => validateToolCall(toolCall, registeredTools)).toThrow(/not registered/);
  });

  it('should reject null arguments', () => {
    const toolCall = {
      id: 'call-123',
      name: 'readFile',
      arguments: null
    } as any;
    expect(() => validateToolCall(toolCall)).toThrow(ValidationError);
    expect(() => validateToolCall(toolCall)).toThrow(/must be a non-null object/);
  });

  it('should reject array arguments', () => {
    const toolCall = {
      id: 'call-123',
      name: 'readFile',
      arguments: []
    } as any;
    expect(() => validateToolCall(toolCall)).toThrow(ValidationError);
    expect(() => validateToolCall(toolCall)).toThrow(/must be a non-null object/);
  });

  it('should accept empty object arguments', () => {
    const toolCall: ToolCall = {
      id: 'call-123',
      name: 'readFile',
      arguments: {}
    };
    expect(() => validateToolCall(toolCall)).not.toThrow();
  });
});

describe('ToolResult validation', () => {
  it('should validate a valid tool result with result', () => {
    const toolResult: ToolResult = {
      id: 'call-123',
      result: 'file content'
    };
    expect(() => validateToolResult(toolResult)).not.toThrow();
  });

  it('should validate a valid tool result with error', () => {
    const toolResult: ToolResult = {
      id: 'call-123',
      error: 'File not found'
    };
    expect(() => validateToolResult(toolResult)).not.toThrow();
  });

  it('should validate tool result with valid tool call IDs', () => {
    const toolResult: ToolResult = {
      id: 'call-123',
      result: 'success'
    };
    const validIds = new Set(['call-123', 'call-456']);
    expect(() => validateToolResult(toolResult, validIds)).not.toThrow();
  });

  it('should reject empty id', () => {
    const toolResult: ToolResult = {
      id: '',
      result: 'data'
    };
    expect(() => validateToolResult(toolResult)).toThrow(ValidationError);
    expect(() => validateToolResult(toolResult)).toThrow(/id must be a non-empty string/);
  });

  it('should reject invalid tool call id', () => {
    const toolResult: ToolResult = {
      id: 'call-999',
      result: 'data'
    };
    const validIds = new Set(['call-123', 'call-456']);
    expect(() => validateToolResult(toolResult, validIds)).toThrow(ValidationError);
    expect(() => validateToolResult(toolResult, validIds)).toThrow(/does not correspond to any ToolCall/);
  });

  it('should reject tool result with neither result nor error', () => {
    const toolResult: ToolResult = {
      id: 'call-123'
    };
    expect(() => validateToolResult(toolResult)).toThrow(ValidationError);
    expect(() => validateToolResult(toolResult)).toThrow(/must have either result or error/);
  });

  it('should reject non-string error', () => {
    const toolResult = {
      id: 'call-123',
      error: 123
    } as any;
    expect(() => validateToolResult(toolResult)).toThrow(ValidationError);
    expect(() => validateToolResult(toolResult)).toThrow(/error must be a string/);
  });

  it('should accept tool result with both result and error', () => {
    const toolResult: ToolResult = {
      id: 'call-123',
      result: 'partial data',
      error: 'warning message'
    };
    expect(() => validateToolResult(toolResult)).not.toThrow();
  });
});

describe('Usage validation', () => {
  it('should validate valid usage', () => {
    const usage: Usage = {
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30
    };
    expect(() => validateUsage(usage)).not.toThrow();
  });

  it('should validate usage with zero tokens', () => {
    const usage: Usage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    };
    expect(() => validateUsage(usage)).not.toThrow();
  });

  it('should reject negative promptTokens', () => {
    const usage: Usage = {
      promptTokens: -1,
      completionTokens: 20,
      totalTokens: 19
    };
    expect(() => validateUsage(usage)).toThrow(ValidationError);
    expect(() => validateUsage(usage)).toThrow(/promptTokens must be a non-negative integer/);
  });

  it('should reject negative completionTokens', () => {
    const usage: Usage = {
      promptTokens: 10,
      completionTokens: -5,
      totalTokens: 5
    };
    expect(() => validateUsage(usage)).toThrow(ValidationError);
    expect(() => validateUsage(usage)).toThrow(/completionTokens must be a non-negative integer/);
  });

  it('should reject negative totalTokens', () => {
    const usage: Usage = {
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: -30
    };
    expect(() => validateUsage(usage)).toThrow(ValidationError);
    expect(() => validateUsage(usage)).toThrow(/totalTokens must be a non-negative integer/);
  });

  it('should reject non-integer promptTokens', () => {
    const usage: Usage = {
      promptTokens: 10.5,
      completionTokens: 20,
      totalTokens: 30
    };
    expect(() => validateUsage(usage)).toThrow(ValidationError);
    expect(() => validateUsage(usage)).toThrow(/promptTokens must be a non-negative integer/);
  });

  it('should reject non-integer completionTokens', () => {
    const usage: Usage = {
      promptTokens: 10,
      completionTokens: 20.7,
      totalTokens: 30
    };
    expect(() => validateUsage(usage)).toThrow(ValidationError);
    expect(() => validateUsage(usage)).toThrow(/completionTokens must be a non-negative integer/);
  });

  it('should reject incorrect totalTokens sum', () => {
    const usage: Usage = {
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 25
    };
    expect(() => validateUsage(usage)).toThrow(ValidationError);
    expect(() => validateUsage(usage)).toThrow(/totalTokens \(25\) must equal promptTokens \(10\) \+ completionTokens \(20\) = 30/);
  });

  it('should reject totalTokens greater than sum', () => {
    const usage: Usage = {
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 35
    };
    expect(() => validateUsage(usage)).toThrow(ValidationError);
  });

  it('should reject totalTokens less than sum', () => {
    const usage: Usage = {
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 20
    };
    expect(() => validateUsage(usage)).toThrow(ValidationError);
  });
});

describe('Type guards', () => {
  describe('isMessageRole', () => {
    it('should return true for valid roles', () => {
      expect(isMessageRole('user')).toBe(true);
      expect(isMessageRole('assistant')).toBe(true);
      expect(isMessageRole('system')).toBe(true);
    });

    it('should return false for invalid roles', () => {
      expect(isMessageRole('invalid')).toBe(false);
      expect(isMessageRole('')).toBe(false);
      expect(isMessageRole(null)).toBe(false);
      expect(isMessageRole(undefined)).toBe(false);
      expect(isMessageRole(123)).toBe(false);
    });
  });
});
