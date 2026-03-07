/**
 * Agent System E2E Tests
 *
 * Tests the full agent lifecycle: create, read, update, delete,
 * file management, identity, and integration with the API server.
 */

import { AgentManager } from './AgentManager';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

let tmpDir: string;
let manager: AgentManager;

beforeEach(async () => {
  tmpDir = path.join(os.tmpdir(), `agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  manager = new AgentManager(tmpDir);
  await manager.initialize();
});

afterEach(async () => {
  try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
});

describe('AgentManager', () => {
  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------
  test('initialize creates agents directory and default agent', async () => {
    const agents = await manager.listAgents();
    expect(agents.length).toBeGreaterThanOrEqual(1);
    const def = agents.find(a => a.id === 'default');
    expect(def).toBeDefined();
    expect(def!.name).toBe('Default Agent');
  });

  test('initialize is idempotent', async () => {
    await manager.initialize();
    await manager.initialize();
    const agents = await manager.listAgents();
    const defaults = agents.filter(a => a.id === 'default');
    expect(defaults.length).toBe(1);
  });

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------
  test('createAgent creates a new agent with config file', async () => {
    const agent = await manager.createAgent({
      id: 'test-agent',
      name: 'Test Agent',
      description: 'A test agent',
      toolProfile: 'minimal',
    });

    expect(agent.id).toBe('test-agent');
    expect(agent.name).toBe('Test Agent');
    expect(agent.toolProfile).toBe('minimal');
    expect(agent.createdAt).toBeDefined();
    expect(agent.updatedAt).toBeDefined();

    // Verify file exists
    const configPath = path.join(tmpDir, 'test-agent', 'agent.json');
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.id).toBe('test-agent');
  });

  test('getAgent returns existing agent', async () => {
    await manager.createAgent({ id: 'lookup-test', name: 'Lookup' });
    const agent = await manager.getAgent('lookup-test');
    expect(agent).toBeDefined();
    expect(agent!.name).toBe('Lookup');
  });

  test('getAgent returns undefined for non-existent agent', async () => {
    const agent = await manager.getAgent('ghost');
    expect(agent).toBeUndefined();
  });

  test('listAgents returns all agents', async () => {
    await manager.createAgent({ id: 'a1', name: 'Agent 1' });
    await manager.createAgent({ id: 'a2', name: 'Agent 2' });
    const agents = await manager.listAgents();
    expect(agents.length).toBeGreaterThanOrEqual(3); // default + a1 + a2
    expect(agents.map(a => a.id)).toContain('a1');
    expect(agents.map(a => a.id)).toContain('a2');
  });

  test('updateAgent updates fields and preserves id', async () => {
    await manager.createAgent({ id: 'upd-test', name: 'Original' });
    const updated = await manager.updateAgent('upd-test', {
      name: 'Updated Name',
      description: 'New description',
      toolProfile: 'full',
      model: { primary: 'openai/gpt-4o', fallbacks: ['anthropic/claude-sonnet-4-20250514'] },
    });

    expect(updated).toBeDefined();
    expect(updated!.id).toBe('upd-test'); // ID preserved
    expect(updated!.name).toBe('Updated Name');
    expect(updated!.description).toBe('New description');
    expect(updated!.toolProfile).toBe('full');
    expect(updated!.model!.primary).toBe('openai/gpt-4o');
    expect(updated!.model!.fallbacks).toEqual(['anthropic/claude-sonnet-4-20250514']);

    // Verify persisted
    const reloaded = await manager.getAgent('upd-test');
    expect(reloaded!.name).toBe('Updated Name');
  });

  test('updateAgent returns undefined for non-existent agent', async () => {
    const result = await manager.updateAgent('ghost', { name: 'X' });
    expect(result).toBeUndefined();
  });

  test('updateAgent updates tools allow/deny lists', async () => {
    await manager.createAgent({ id: 'tools-test', name: 'Tools Test' });
    const updated = await manager.updateAgent('tools-test', {
      tools: {
        allow: ['readFile', 'writeFile'],
        deny: ['shellExecute'],
      },
    });
    expect(updated!.tools!.allow).toEqual(['readFile', 'writeFile']);
    expect(updated!.tools!.deny).toEqual(['shellExecute']);
  });

  test('updateAgent updates skillFilter', async () => {
    await manager.createAgent({ id: 'skill-test', name: 'Skill Test' });
    const updated = await manager.updateAgent('skill-test', {
      skillFilter: ['web-search', 'code-review'],
    });
    expect(updated!.skillFilter).toEqual(['web-search', 'code-review']);
  });

  // -----------------------------------------------------------------------
  // Delete
  // -----------------------------------------------------------------------
  test('deleteAgent removes agent and its directory', async () => {
    await manager.createAgent({ id: 'del-test', name: 'Delete Me' });
    expect(await manager.getAgent('del-test')).toBeDefined();

    const result = await manager.deleteAgent('del-test');
    expect(result).toBe(true);
    expect(await manager.getAgent('del-test')).toBeUndefined();

    // Directory should be gone
    const dirExists = await fs.access(path.join(tmpDir, 'del-test')).then(() => true).catch(() => false);
    expect(dirExists).toBe(false);
  });

  test('deleteAgent returns false for non-existent agent', async () => {
    const result = await manager.deleteAgent('ghost');
    expect(result).toBe(false);
  });

  test('deleteAgent prevents deleting default agent', async () => {
    const result = await manager.deleteAgent('default');
    expect(result).toBe(false);
    expect(await manager.getAgent('default')).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // File management
  // -----------------------------------------------------------------------
  test('setFile and getFile round-trip', async () => {
    await manager.createAgent({ id: 'file-test', name: 'File Test' });
    await manager.setFile('file-test', 'SOUL.md', '# Be helpful and direct');
    const content = await manager.getFile('file-test', 'SOUL.md');
    expect(content).toBe('# Be helpful and direct');
  });

  test('getFile returns null for non-existent file', async () => {
    await manager.createAgent({ id: 'file-test2', name: 'File Test 2' });
    const content = await manager.getFile('file-test2', 'NONEXISTENT.md');
    expect(content).toBeNull();
  });

  test('listFiles returns agent files', async () => {
    await manager.createAgent({ id: 'files-list', name: 'Files List' });
    await manager.setFile('files-list', 'SOUL.md', 'soul content');
    await manager.setFile('files-list', 'AGENTS.md', 'agents content');
    const files = await manager.listFiles('files-list');
    expect(files).toContain('agent.json');
    expect(files).toContain('SOUL.md');
    expect(files).toContain('AGENTS.md');
  });

  // -----------------------------------------------------------------------
  // Identity
  // -----------------------------------------------------------------------
  test('getIdentity returns agent identity', async () => {
    await manager.createAgent({ id: 'id-test', name: 'Identity Test', description: 'A test' });
    const identity = await manager.getIdentity('id-test');
    expect(identity).toBeDefined();
    expect(identity!.agentId).toBe('id-test');
    expect(identity!.name).toBe('Identity Test');
  });

  test('getIdentity includes IDENTITY.md content as personality', async () => {
    await manager.createAgent({ id: 'personality-test', name: 'Personality' });
    await manager.setFile('personality-test', 'IDENTITY.md', 'I am a friendly coding assistant.');
    const identity = await manager.getIdentity('personality-test');
    expect(identity!.personality).toBe('I am a friendly coding assistant.');
  });

  test('getIdentity returns null for non-existent agent', async () => {
    const identity = await manager.getIdentity('ghost');
    expect(identity).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Persistence across reload
  // -----------------------------------------------------------------------
  test('agents persist across manager reload', async () => {
    await manager.createAgent({
      id: 'persist-test',
      name: 'Persistent',
      model: { primary: 'openai/gpt-4o', fallbacks: [] },
    });

    // Create a new manager pointing to same directory
    const manager2 = new AgentManager(tmpDir);
    await manager2.initialize();

    const agent = await manager2.getAgent('persist-test');
    expect(agent).toBeDefined();
    expect(agent!.name).toBe('Persistent');
    expect(agent!.model!.primary).toBe('openai/gpt-4o');
  });
});
