/**
 * Tests for subAgentTools — sub-agent spawning
 */

import { createSubAgentTool, SubAgentContext } from './subAgentTools';

describe('subAgentTools', () => {
  let mockCtx: SubAgentContext;
  let executeCalls: any[];

  beforeEach(() => {
    executeCalls = [];
    mockCtx = {
      executeSubAgent: jest.fn(async (opts) => {
        executeCalls.push(opts);
        return `Result for: ${opts.task}`;
      }),
    };
  });

  it('spawns a sub-agent and returns result', async () => {
    const tool = createSubAgentTool(mockCtx);
    const result = await tool.execute({
      task: 'Analyze this code',
      __sessionId: 'parent-1',
      __model: 'gpt-4',
      __depth: 0,
    });

    expect(result.status).toBe('completed');
    expect(result.result).toContain('Analyze this code');
    expect(executeCalls).toHaveLength(1);
    expect(executeCalls[0].depth).toBe(1);
    expect(executeCalls[0].parentSessionId).toBe('parent-1');
  });

  it('rejects empty task', async () => {
    const tool = createSubAgentTool(mockCtx);
    await expect(tool.execute({ task: '' })).rejects.toThrow('non-empty');
  });

  it('rejects when depth limit is reached', async () => {
    const tool = createSubAgentTool(mockCtx);
    await expect(
      tool.execute({ task: 'deep task', __depth: 3 }),
    ).rejects.toThrow('depth limit');
  });

  it('truncates long results', async () => {
    mockCtx.executeSubAgent = jest.fn(async () => 'x'.repeat(5000));
    const tool = createSubAgentTool(mockCtx);
    const result = await tool.execute({ task: 'big task', __depth: 0 });
    expect(result.result.length).toBeLessThanOrEqual(4020); // 4000 + truncation marker
    expect(result.result).toContain('[...truncated]');
  });

  it('uses default model when not specified', async () => {
    const tool = createSubAgentTool(mockCtx);
    await tool.execute({ task: 'test', __depth: 0 });
    expect(executeCalls[0].model).toBe('gpt-3.5-turbo');
  });

  it('uses specified model', async () => {
    const tool = createSubAgentTool(mockCtx);
    await tool.execute({ task: 'test', model: 'claude-3-opus', __depth: 0 });
    expect(executeCalls[0].model).toBe('claude-3-opus');
  });
});
